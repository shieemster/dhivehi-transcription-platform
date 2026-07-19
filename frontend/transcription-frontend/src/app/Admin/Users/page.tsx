'use client'
import * as React from "react";
const { useState, useEffect, useCallback } = React;
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BACKEND_URL } from "@/config";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, ApiError } from "@/lib/api";
import {
  ArrowLeft,
  Moon,
  Sun,
  UserPlus,
  ShieldCheck,
  ShieldOff,
  Loader2,
  AlertCircle,
  UserX,
  UserCheck,
  Check,
} from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" disabled>
        <Sun className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      className="hover:scale-110 transition-all duration-300 ease-in-out"
    >
      {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
    </Button>
  );
}

const ROLES = ["dispatcher", "analyst", "supervisor", "administrator"] as const;

interface ManagedUser {
  id: string;
  email: string;
  display_name: string;
  role_name: string;
  mfa_enabled: boolean;
  is_active: boolean;
  created_at: string;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { user, isAuthenticated, authFetch, isLoading: authLoading } = useAuth();

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<string>("analyst");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [deactivateConfirm, setDeactivateConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    if (user && user.role !== "administrator") {
      router.push("/");
    }
  }, [authLoading, isAuthenticated, user, router]);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<ManagedUser[]>(authFetch, `${BACKEND_URL}/users`);
      setUsers(data ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [authFetch, router]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    if (user && user.role !== "administrator") return;
    loadUsers();
  }, [authLoading, isAuthenticated, user, loadUsers]);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    try {
      setCreateSubmitting(true);
      const created = await apiFetch<ManagedUser>(authFetch, `${BACKEND_URL}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          display_name: newDisplayName,
          password: newPassword,
          role_name: newRole,
        }),
      });
      setUsers(prev => [...prev, created]);
      setNewEmail("");
      setNewDisplayName("");
      setNewPassword("");
      setNewRole("analyst");
      setShowCreateForm(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreateSubmitting(false);
    }
  }

  function setBusy(id: string, busy: boolean) {
    setRowBusy(prev => {
      const next = new Set(prev);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function handleRoleChange(targetUser: ManagedUser, roleName: string) {
    if (roleName === targetUser.role_name) return;
    setRowError(prev => ({ ...prev, [targetUser.id]: "" }));
    try {
      setBusy(targetUser.id, true);
      const updated = await apiFetch<ManagedUser>(authFetch, `${BACKEND_URL}/users/${targetUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_name: roleName }),
      });
      setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)));
    } catch (err) {
      setRowError(prev => ({ ...prev, [targetUser.id]: err instanceof Error ? err.message : "Failed to change role" }));
    } finally {
      setBusy(targetUser.id, false);
    }
  }

  async function handleReactivate(targetUser: ManagedUser) {
    setRowError(prev => ({ ...prev, [targetUser.id]: "" }));
    try {
      setBusy(targetUser.id, true);
      const updated = await apiFetch<ManagedUser>(authFetch, `${BACKEND_URL}/users/${targetUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)));
    } catch (err) {
      setRowError(prev => ({ ...prev, [targetUser.id]: err instanceof Error ? err.message : "Failed to reactivate" }));
    } finally {
      setBusy(targetUser.id, false);
    }
  }

  async function handleDeactivate(targetUser: ManagedUser) {
    if (deactivateConfirm !== targetUser.id) {
      setDeactivateConfirm(targetUser.id);
      setTimeout(() => setDeactivateConfirm(prev => (prev === targetUser.id ? null : prev)), 3000);
      return;
    }
    setRowError(prev => ({ ...prev, [targetUser.id]: "" }));
    try {
      setBusy(targetUser.id, true);
      const updated = await apiFetch<ManagedUser>(authFetch, `${BACKEND_URL}/users/${targetUser.id}`, {
        method: "DELETE",
      });
      setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)));
      setDeactivateConfirm(null);
    } catch (err) {
      setRowError(prev => ({ ...prev, [targetUser.id]: err instanceof Error ? err.message : "Failed to deactivate" }));
    } finally {
      setBusy(targetUser.id, false);
    }
  }

  if (authLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-stone-600 dark:text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 transition-all duration-500 ease-in-out">
      <header className="backdrop-blur-sm shadow-md dark:shadow-lg">
        <div className="max-w-6xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
          <h1
            className="text-2xl font-bold text-neutral-700 dark:text-white cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-200"
            onClick={() => router.push("/")}
          >
            User Management
          </h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <Button
          onClick={() => router.push("/")}
          variant="ghost"
          className="text-stone-700 dark:text-neutral-300 hover:text-stone-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Button>

        <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg text-neutral-900 dark:text-white flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Accounts
            </CardTitle>
            <Button size="sm" onClick={() => setShowCreateForm(v => !v)}>
              {showCreateForm ? "Cancel" : "New User"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {showCreateForm && (
              <form onSubmit={handleCreateUser} className="space-y-3 border border-stone-300 dark:border-neutral-600 rounded-lg p-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-sm text-stone-600 dark:text-neutral-400">Email</Label>
                    <Input type="email" required value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm text-stone-600 dark:text-neutral-400">Display name</Label>
                    <Input required value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm text-stone-600 dark:text-neutral-400">Temporary password</Label>
                    <Input type="password" required minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm text-stone-600 dark:text-neutral-400">Role</Label>
                    <select
                      value={newRole}
                      onChange={e => setNewRole(e.target.value)}
                      className="w-full h-9 rounded-md border border-stone-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 text-sm text-stone-900 dark:text-white capitalize"
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r} className="capitalize">{r}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-stone-500 dark:text-neutral-500">
                  At least 8 characters. The new user should change this on first login.
                  {(newRole === "administrator" || newRole === "supervisor") && (
                    <> This role requires MFA — they&apos;ll be asked to enroll immediately after their first login.</>
                  )}
                </p>
                {createError && (
                  <p className="text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {createError}
                  </p>
                )}
                <Button type="submit" disabled={createSubmitting}>
                  {createSubmitting ? "Creating…" : "Create User"}
                </Button>
              </form>
            )}

            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-stone-500 dark:text-neutral-400" />
              </div>
            ) : error ? (
              <p className="text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-stone-500 dark:text-neutral-400 border-b border-stone-300 dark:border-neutral-700">
                      <th className="py-2 pr-4 font-medium">User</th>
                      <th className="py-2 pr-4 font-medium">Role</th>
                      <th className="py-2 pr-4 font-medium">MFA</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Created</th>
                      <th className="py-2 pr-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => {
                      const isSelf = u.id === user?.id;
                      const busy = rowBusy.has(u.id);
                      return (
                        <tr key={u.id} className="border-b border-stone-200 dark:border-neutral-800">
                          <td className="py-3 pr-4">
                            <div className="text-stone-900 dark:text-white font-medium">{u.display_name}</div>
                            <div className="text-stone-500 dark:text-neutral-400 text-xs">{u.email}{isSelf && " (you)"}</div>
                            {rowError[u.id] && (
                              <div className="text-xs text-red-700 dark:text-red-400 mt-1">{rowError[u.id]}</div>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            <select
                              value={u.role_name}
                              disabled={isSelf || busy}
                              onChange={e => handleRoleChange(u, e.target.value)}
                              className="h-8 rounded-md border border-stone-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 text-sm text-stone-900 dark:text-white capitalize disabled:opacity-50"
                            >
                              {ROLES.map(r => (
                                <option key={r} value={r} className="capitalize">{r}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-3 pr-4">
                            {u.mfa_enabled ? (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 gap-1">
                                <ShieldCheck className="w-3 h-3" /> On
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 text-stone-500 dark:text-neutral-400">
                                <ShieldOff className="w-3 h-3" /> Off
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {u.is_active ? (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Active</Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Deactivated</Badge>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-stone-500 dark:text-neutral-400">
                            {new Date(u.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-3 pr-4 text-right">
                            {isSelf ? (
                              <span className="text-xs text-stone-400 dark:text-neutral-500">—</span>
                            ) : busy ? (
                              <Loader2 className="w-4 h-4 animate-spin inline-block text-stone-500 dark:text-neutral-400" />
                            ) : u.is_active ? (
                              <Button
                                size="sm"
                                variant={deactivateConfirm === u.id ? "destructive" : "outline"}
                                onClick={() => handleDeactivate(u)}
                              >
                                <UserX className="w-4 h-4 mr-1" />
                                {deactivateConfirm === u.id ? "Confirm?" : "Deactivate"}
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => handleReactivate(u)}>
                                <UserCheck className="w-4 h-4 mr-1" />
                                Reactivate
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {users.length === 0 && (
                  <p className="text-sm text-stone-500 dark:text-neutral-400 py-6 text-center">No users found.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
