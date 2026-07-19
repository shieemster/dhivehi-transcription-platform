'use client'
import * as React from "react";
const { useState, useEffect, useRef } = React;
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { LayoutDashboard, ShieldCheck, Users, Activity } from "lucide-react";

const ADMIN_LINKS = [
  { label: "Admin Dashboard", href: "/Admin", icon: LayoutDashboard },
  { label: "Security Dashboard", href: "/Security", icon: ShieldCheck },
  { label: "User Management", href: "/Admin/Users", icon: Users },
  { label: "System Health", href: "/Admin/Health", icon: Activity },
];

// Single admin-only nav entry point, available from every page's header
// instead of three separate icon buttons that used to only exist on the
// home page. Checks the current user's role itself, so call sites don't
// need to gate on it — drop <AdminMenu /> into any header and it renders
// nothing for non-administrators.
export function AdminMenu() {
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (user?.role !== "administrator") return null;

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(v => !v)}
        title="Admin"
        className="transition-all duration-300 ease-in-out hover:scale-110"
      >
        <ShieldCheck className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-md border bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 shadow-md overflow-hidden">
          {ADMIN_LINKS.map(({ label, href, icon: Icon }) => (
            <button
              key={href}
              type="button"
              onClick={() => {
                setOpen(false);
                router.push(href);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-stone-700 dark:text-neutral-300 hover:bg-stone-100 dark:hover:bg-neutral-700 transition-colors"
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
