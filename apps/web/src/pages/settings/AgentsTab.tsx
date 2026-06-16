// ─── Settings · Agents tab ────────────────────────────────────────────────────
// Lists agents in the current tenant, lets admins invite teammates, change
// roles, and deactivate. Talks to /api/agents, /api/agents/invite, and
// /api/agents/:id (PATCH/DELETE).

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Trash2, Loader2, Mail, ShieldCheck, X } from "lucide-react";
import { api } from "../../lib/api";
import { useAuthStore } from "../../store/auth.store";
import { cn } from "../../lib/utils";

// ─── Shape returned by GET /api/agents ──────────────────────────────────────

export interface AgentSummary {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  isActive: boolean;
  isOnline: boolean;
  lastSeenAt: string | null;
  invitePending: boolean;
  inviteSentAt: string | null;
  createdAt: string | null;
}

interface ListResponse {
  agents: AgentSummary[];
}

// ─── Small UI primitives (kept local to avoid widening exports) ─────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-primary">{label}</label>
      {children}
      {hint && <p className="text-xs text-text-secondary">{hint}</p>}
    </div>
  );
}

function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-text-primary",
        "placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function StyledSelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-text-primary",
        "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

const ROLE_BADGE: Record<string, string> = {
  super_admin: "bg-warning/10 text-warning",
  admin: "bg-primary/10 text-primary",
  agent: "bg-success/10 text-success",
  viewer: "bg-border text-text-secondary",
};

// ─── Modal (simple overlay) ─────────────────────────────────────────────────

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-background border border-border rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <p className="text-sm font-semibold text-text-primary">{title}</p>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// ─── Main tab ───────────────────────────────────────────────────────────────

export function AgentsTab() {
  const me = useAuthStore((s) => s.agent);
  const queryClient = useQueryClient();
  const isAdmin = me?.role === "admin" || me?.role === "super_admin";

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"agent" | "admin">("agent");

  const listQuery = useQuery<ListResponse>({
    queryKey: ["agents"],
    queryFn: async () => {
      const r = await api.get<ListResponse>("/agents");
      return r.data;
    },
    staleTime: 30_000,
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      await api.post("/agents/invite", {
        email: inviteEmail.trim(),
        name: inviteName.trim(),
        role: inviteRole,
      });
    },
    onSuccess: () => {
      toast.success(`Invite sent to ${inviteEmail}`);
      setShowInvite(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("agent");
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (err: {
      response?: { data?: { error?: { message?: string } } };
    }) => {
      toast.error(err?.response?.data?.error?.message ?? "Invite failed");
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async (vars: { id: string; role: string }) => {
      await api.patch(`/agents/${vars.id}`, { role: vars.role });
    },
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (err: {
      response?: { data?: { error?: { message?: string } } };
    }) => {
      toast.error(
        err?.response?.data?.error?.message ?? "Could not update role",
      );
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/agents/${id}`);
    },
    onSuccess: () => {
      toast.success("Agent deactivated");
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (err: {
      response?: { data?: { error?: { message?: string } } };
    }) => {
      toast.error(err?.response?.data?.error?.message ?? "Deactivate failed");
    },
  });

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteName) return;
    inviteMutation.mutate();
  };

  const agents = listQuery.data?.agents ?? [];
  const activeCount = agents.filter((a) => a.isActive).length;
  const pendingCount = agents.filter((a) => a.invitePending).length;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-secondary">
            {activeCount} active agent{activeCount === 1 ? "" : "s"}
            {pendingCount > 0 &&
              ` · ${pendingCount} pending invite${pendingCount === 1 ? "" : "s"}`}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Invite teammate
          </button>
        )}
      </div>

      {listQuery.isLoading && (
        <div className="flex items-center justify-center p-12 text-text-secondary text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading agents…
        </div>
      )}

      {!listQuery.isLoading && agents.length === 0 && (
        <div className="p-12 text-center text-sm text-text-secondary border border-dashed border-border rounded-xl">
          No agents yet — invite your first teammate.
        </div>
      )}

      <div className="space-y-2">
        {agents.map((a) => {
          const isMe = a.id === me?.id;
          const canEdit = isAdmin && !isMe;
          return (
            <div
              key={a.id}
              className="flex items-center gap-3 p-3 bg-surface border border-border rounded-xl"
            >
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                {a.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">
                  {a.name}
                  {isMe && (
                    <span className="ml-2 text-xs text-text-secondary">
                      (you)
                    </span>
                  )}
                </p>
                <p className="text-xs text-text-secondary truncate">
                  {a.email}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {a.invitePending && (
                  <span className="flex items-center gap-1 text-xs text-warning bg-warning/10 px-2 py-0.5 rounded-full">
                    <Mail className="w-3 h-3" /> Invited
                  </span>
                )}
                {!a.isActive && !a.invitePending && (
                  <span className="text-xs text-text-secondary bg-border/40 px-2 py-0.5 rounded-full">
                    Inactive
                  </span>
                )}
                {a.isActive && a.isOnline && (
                  <span className="flex items-center gap-1 text-xs text-success bg-success/10 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    Online
                  </span>
                )}

                {canEdit ? (
                  <StyledSelect
                    value={a.role}
                    onChange={(e) =>
                      updateRoleMutation.mutate({
                        id: a.id,
                        role: e.target.value,
                      })
                    }
                    className="w-28 py-1 text-xs"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="agent">Agent</option>
                    <option value="admin">Admin</option>
                    {me?.role === "super_admin" && (
                      <option value="super_admin">Super admin</option>
                    )}
                  </StyledSelect>
                ) : (
                  <span
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full capitalize font-medium",
                      ROLE_BADGE[a.role] ?? "bg-border text-text-secondary",
                    )}
                  >
                    {a.role.replace("_", " ")}
                  </span>
                )}

                {canEdit && a.isActive && (
                  <button
                    onClick={() => {
                      if (confirm(`Deactivate ${a.name}?`)) {
                        deactivateMutation.mutate(a.id);
                      }
                    }}
                    className="p-1 text-text-secondary hover:text-error transition-colors"
                    title="Deactivate"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        title="Invite a teammate"
      >
        <form onSubmit={handleInviteSubmit} className="space-y-4">
          <Field label="Name">
            <Input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Jane Doe"
              required
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="jane@yourbrand.com"
              required
            />
          </Field>
          <Field
            label="Role"
            hint="Admins can manage settings and other agents."
          >
            <StyledSelect
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(e.target.value as "agent" | "admin")
              }
            >
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </StyledSelect>
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowInvite(false)}
              className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={inviteMutation.isPending || !inviteEmail || !inviteName}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {inviteMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              Send invite
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
