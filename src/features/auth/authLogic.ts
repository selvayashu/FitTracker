const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | null {
  if (!email.trim()) return "Enter your email address.";
  return EMAIL_RE.test(email.trim()) ? null : "That does not look like a valid email address.";
}

export function validatePassword(password: string): string | null {
  if (!password) return "Enter a password.";
  return password.length >= 8 ? null : "Password must be at least 8 characters.";
}

/** Turn a Supabase auth error message into something a person can act on. */
export function mapAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (m.includes("email not confirmed")) return "Please confirm your email first. Check your inbox for the confirmation link.";
  if (m.includes("already registered") || m.includes("already been registered")) return "An account with this email already exists. Try signing in instead.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a minute and try again.";
  if (m.includes("password") && (m.includes("weak") || m.includes("least"))) return "Choose a stronger password (at least 8 characters).";
  if (m.includes("failed to fetch") || m.includes("network")) return "Network problem. Check your connection and try again.";
  if (m.includes("provider") && m.includes("not enabled")) return "Google sign-in is not enabled for this project yet.";
  return message || "Something went wrong. Please try again.";
}
