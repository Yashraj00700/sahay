import { useState, useMemo } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Eye, EyeOff, ArrowRight, Loader2, Check, X } from "lucide-react";
import { api } from "../../lib/api";
import { useAuthStore } from "../../store/auth.store";
import type { AuthResponse } from "@sahay/shared";

// ─── Password complexity rules (mirror server-side reset-password schema) ────

interface RuleCheck {
  label: string;
  ok: boolean;
}

function checkPassword(p: string): RuleCheck[] {
  return [
    { label: "At least 10 characters", ok: p.length >= 10 },
    { label: "One uppercase letter", ok: /[A-Z]/.test(p) },
    { label: "One lowercase letter", ok: /[a-z]/.test(p) },
    { label: "One number", ok: /[0-9]/.test(p) },
  ];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface AcceptInviteError {
  response?: { data?: { error?: { message?: string } } };
}

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { setAuth } = useAuthStore();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  const rules = useMemo(() => checkPassword(password), [password]);
  const allRulesPass = rules.every((r) => r.ok);
  const passwordsMatch = password.length > 0 && password === confirm;

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<AuthResponse>("/auth/accept-invite", {
        token,
        password,
      });
      return response.data;
    },
    onSuccess: (data) => {
      setAuth({
        token: data.token,
        refreshToken: data.refreshToken,
        agent: data.agent,
        tenant: data.tenant,
      });
      toast.success(`Welcome aboard, ${data.agent.name}!`, {
        style: {
          background: "#1a1628",
          color: "#fff",
          border: "1px solid #6B4EFF40",
        },
      });
      navigate("/inbox");
    },
    onError: (error: AcceptInviteError) => {
      const message =
        error?.response?.data?.error?.message ??
        "Invalid or expired invite link";
      toast.error(message, {
        style: {
          background: "#1a1628",
          color: "#fff",
          border: "1px solid #ef444440",
        },
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !allRulesPass || !passwordsMatch) return;
    acceptMutation.mutate();
  };

  if (!token) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-8"
        style={{
          background: "linear-gradient(160deg, #0f0d1e 0%, #0d0b1a 100%)",
          fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
        }}
      >
        <div className="text-center max-w-sm">
          <h2 className="text-2xl font-bold text-white mb-3">
            Invalid invite link
          </h2>
          <p className="text-sm text-white/50 mb-6">
            This link is missing its token. Ask your admin to send a new invite.
          </p>
          <Link
            to="/login"
            className="text-sm font-medium"
            style={{ color: "rgba(107,78,255,0.85)" }}
          >
            Back to sign in →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-8 relative"
      style={{
        background: "linear-gradient(160deg, #0f0d1e 0%, #0d0b1a 100%)",
        fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
      }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute"
          style={{
            width: 400,
            height: 400,
            top: "10%",
            right: "-100px",
            background:
              "radial-gradient(circle, #6B4EFF0D 0%, transparent 60%)",
            filter: "blur(60px)",
          }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Logo */}
        <div className="flex items-center gap-2 mb-10">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, #6B4EFF, #8669FF)",
              boxShadow: "0 0 20px #6B4EFF50",
            }}
          >
            <span
              className="text-white font-black text-base leading-none"
              style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}
            >
              स
            </span>
          </div>
          <span className="text-white text-lg font-bold tracking-tight">
            sahay
          </span>
        </div>

        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-1.5">
            Accept your invite
          </h2>
          <p className="text-sm text-white/50">
            Set a password to join your team
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              className="block text-xs font-semibold mb-2 uppercase tracking-wider"
              style={{
                color:
                  focused === "password" ? "#8669FF" : "rgba(255,255,255,0.45)",
              }}
            >
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocused("password")}
                onBlur={() => setFocused(null)}
                placeholder="At least 10 characters"
                required
                autoComplete="new-password"
                autoFocus
                style={{
                  width: "100%",
                  padding: "12px 44px 12px 16px",
                  borderRadius: "12px",
                  border: `1px solid ${
                    focused === "password"
                      ? "rgba(107,78,255,0.6)"
                      : "rgba(255,255,255,0.1)"
                  }`,
                  background: "rgba(255,255,255,0.05)",
                  color: "#fff",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: "rgba(255,255,255,0.3)" }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label
              className="block text-xs font-semibold mb-2 uppercase tracking-wider"
              style={{
                color:
                  focused === "confirm" ? "#8669FF" : "rgba(255,255,255,0.45)",
              }}
            >
              Confirm password
            </label>
            <input
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onFocus={() => setFocused("confirm")}
              onBlur={() => setFocused(null)}
              placeholder="Re-enter password"
              required
              autoComplete="new-password"
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "12px",
                border: `1px solid ${
                  focused === "confirm"
                    ? "rgba(107,78,255,0.6)"
                    : "rgba(255,255,255,0.1)"
                }`,
                background: "rgba(255,255,255,0.05)",
                color: "#fff",
                fontSize: "14px",
                outline: "none",
              }}
            />
          </div>

          {/* Rule checklist */}
          {password.length > 0 && (
            <ul className="space-y-1.5 pt-1">
              {rules.map((r) => (
                <li
                  key={r.label}
                  className="flex items-center gap-2 text-xs"
                  style={{
                    color: r.ok
                      ? "rgba(16,185,129,0.9)"
                      : "rgba(255,255,255,0.35)",
                  }}
                >
                  {r.ok ? <Check size={12} /> : <X size={12} />}
                  {r.label}
                </li>
              ))}
              <li
                className="flex items-center gap-2 text-xs"
                style={{
                  color: passwordsMatch
                    ? "rgba(16,185,129,0.9)"
                    : "rgba(255,255,255,0.35)",
                }}
              >
                {passwordsMatch ? <Check size={12} /> : <X size={12} />}
                Passwords match
              </li>
            </ul>
          )}

          <motion.button
            type="submit"
            whileTap={{ scale: 0.98 }}
            disabled={
              acceptMutation.isPending || !allRulesPass || !passwordsMatch
            }
            className="w-full flex items-center justify-center gap-2 font-bold"
            style={{
              padding: "13px 24px",
              borderRadius: "12px",
              border: "none",
              cursor:
                acceptMutation.isPending || !allRulesPass || !passwordsMatch
                  ? "not-allowed"
                  : "pointer",
              background:
                acceptMutation.isPending || !allRulesPass || !passwordsMatch
                  ? "rgba(107,78,255,0.3)"
                  : "linear-gradient(135deg, #6B4EFF 0%, #8669FF 100%)",
              color: "#fff",
              fontSize: "14px",
              marginTop: "8px",
            }}
          >
            {acceptMutation.isPending ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Setting up your account…
              </>
            ) : (
              <>
                Accept invite
                <ArrowRight size={15} />
              </>
            )}
          </motion.button>
        </form>

        <p
          className="text-center text-xs mt-8"
          style={{ color: "rgba(255,255,255,0.2)" }}
        >
          Already have an account?{" "}
          <Link
            to="/login"
            className="transition-colors"
            style={{ color: "rgba(107,78,255,0.7)" }}
          >
            Sign in →
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
