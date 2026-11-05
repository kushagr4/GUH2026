/**
 * Turns Supabase Auth errors into messages a person can act on. The email cases
 * matter on the free plan: the built-in mailer only reaches organisation members
 * and is limited to about 2 messages an hour.
 */
const MESSAGES: Record<string, string> = {
  invalid_credentials: "Incorrect email or password.",
  email_not_confirmed:
    "This email is not confirmed yet. Check your inbox, or ask the project owner to turn off email confirmation.",
  user_already_exists: "An account with this email already exists. Try signing in.",
  email_exists: "An account with this email already exists. Try signing in.",
  weak_password: "That password is too weak. Try a longer one.",
  signup_disabled: "New sign-ups are currently turned off.",
  email_address_invalid: "That email address cannot be used. Try a different one.",
  email_address_not_authorized:
    "Supabase's built-in email only reaches organisation members. Ask the project owner to turn off email confirmation.",
  over_email_send_rate_limit:
    "The built-in email limit has been reached (about 2 an hour). Ask the project owner to turn off email confirmation.",
  over_request_rate_limit:
    "Too many attempts from this network. Wait a few minutes, or use a pre-created demo account.",
};

const FALLBACK = "We could not complete that. Please try again.";

export function friendlyAuthError(error: { code?: string; message?: string }): string {
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code];
  // Older Auth responses carry only a message for this case.
  if (error.message?.includes("not authorized")) {
    return MESSAGES.email_address_not_authorized;
  }
  return FALLBACK;
}
