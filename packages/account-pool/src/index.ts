import type { Account, AccountCredential, PoolFailure } from "@command-go-pool/shared";
import { newId } from "@command-go-pool/shared";
import type { AccountRepo, SecretStore } from "@command-go-pool/storage";
import { applyFailure, applySuccess, isEligible, maybeRecover } from "./state.js";

export class AccountPool {
  private accounts = new Map<string, Account>();
  private rr = 0;

  constructor(
    private readonly repo: Pick<AccountRepo, "list" | "upsert" | "remove">,
    private readonly secrets: SecretStore,
    initialAccounts?: Account[],
  ) {
    for (const account of initialAccounts ?? repo.list()) this.accounts.set(account.id, account);
  }

  list(): Account[] {
    return [...this.accounts.values()];
  }

  get(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  credential(id: string): AccountCredential | undefined {
    const account = this.accounts.get(id);
    if (!account) return undefined;
    const apiKey = this.secrets.get(account.credentialRef);
    if (!apiKey) return undefined;
    return { accountId: id, apiKey };
  }

  eligible(model?: string, now = Date.now()): Account[] {
    return this.list().filter((a) => isEligible(a, model, now));
  }

  nextRoundRobin(model?: string): Account | undefined {
    const eligible = this.eligible(model);
    if (eligible.length === 0) return undefined;
    const account = eligible[this.rr % eligible.length];
    this.rr += 1;
    return account;
  }

  add(input: { label: string; apiKey: string; monthlySubscriptionCost?: number }): Account {
    const credentialRef = this.secrets.put(input.apiKey);
    const account: Account = {
      id: newId("acc"),
      label: input.label,
      enabled: true,
      credentialRef,
      status: "available",
      healthScore: 1,
      activeSessionCount: 0,
      monthlySubscriptionCost: input.monthlySubscriptionCost,
      quota: {},
    };
    this.accounts.set(account.id, account);
    this.repo.upsert(account);
    return account;
  }

  update(id: string, patch: Partial<Account>): Account {
    const current = this.must(id);
    const next = { ...current, ...patch, id, credentialRef: patch.credentialRef ?? current.credentialRef };
    this.accounts.set(id, next);
    this.repo.upsert(next);
    return next;
  }

  replaceCredential(id: string, apiKey: string): Account {
    const current = this.must(id);
    this.secrets.delete(current.credentialRef);
    return this.update(id, { credentialRef: this.secrets.put(apiKey) });
  }

  replace(account: Account): Account {
    this.accounts.set(account.id, account);
    this.repo.upsert(account);
    return account;
  }

  remove(id: string): void {
    const account = this.accounts.get(id);
    if (account) this.secrets.delete(account.credentialRef);
    this.accounts.delete(id);
    this.repo.remove(id);
  }

  markSuccess(id: string): Account {
    return this.replace(applySuccess(this.must(id)));
  }

  markFailure(id: string, failure: PoolFailure): Account {
    return this.replace(applyFailure(this.must(id), failure));
  }

  bumpSessions(id: string, delta: number): void {
    const account = this.must(id);
    const count = Math.max(0, account.activeSessionCount + delta);
    this.replace({
      ...account,
      activeSessionCount: count,
      status: account.status === "available" || account.status === "active" ? (count > 0 ? "active" : "available") : account.status,
    });
  }

  recoverExpired(now = Date.now()): Account[] {
    const recovered: Account[] = [];
    for (const account of this.list()) {
      const next = maybeRecover(account, now);
      if (!next) continue;
      this.replace(next);
      recovered.push(next);
    }
    return recovered;
  }

  private must(id: string): Account {
    const account = this.accounts.get(id);
    if (!account) throw new Error(`Unknown account ${id}`);
    return account;
  }
}

export { isEligible, applyFailure, applySuccess, maybeRecover } from "./state.js";
