-- CreateIndex
CREATE INDEX "idx_notif_user_sent" ON "notifications"("user_id", "sent_at" DESC);
