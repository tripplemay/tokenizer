-- Keep latest-window lookups bounded to one provider account.
CREATE INDEX "QuotaSnapshot_user_provider_account_window_captured_idx"
  ON "QuotaSnapshot" ("userId", "provider", "accountKey", "windowKey", "capturedAt");
