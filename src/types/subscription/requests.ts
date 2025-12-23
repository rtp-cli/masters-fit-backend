// RevenueCat webhook payload types
export interface RevenueCatWebhookEvent {
  id: string;
  type:
    | "INITIAL_PURCHASE"
    | "RENEWAL"
    | "CANCELLATION"
    | "EXPIRATION"
    | "BILLING_ISSUE";
  app_user_id: string;
  product_id: string;
  subscription_id?: string;
  purchased_at?: string;
  expires_at?: string;
  canceled_at?: string;
}

export interface RevenueCatWebhookPayload {
  event: RevenueCatWebhookEvent;
}
