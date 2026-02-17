"use client"

import * as React from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getBackHref } from "@/lib/utils/backNavigation"
import { getParentHref } from "@/lib/config/backNavigation"

interface BackButtonProps {
  className?: string
  userRole?: {
    isManager?: boolean
    isAdmin?: boolean
  }
  fallbackHref?: string
}

/**
 * Standardized back button component
 * - Icon-only for clean UI
 * - High contrast for visibility on dark backgrounds
 * - Uses browser history (router.back) when available so it returns
 *   to whichever page the user actually came from
 * - Falls back to computed parent route for direct URL access
 */
export function BackButton({ className, userRole, fallbackHref }: BackButtonProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  
  const handleBack = () => {
    // Prefer browser back navigation — this correctly returns to /approvals,
    // /timesheets, or wherever the user actually navigated from.
    // history.length > 1 means there is at least one previous entry.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }

    // Fallback for direct URL access (no browser history):
    // use ?from= param or computed parent route from sitemap config
    const from = searchParams.get('from') || searchParams.get('fromTab')
    const computedFallback = fallbackHref || getParentHref(pathname, searchParams, userRole)
    const backHref = getBackHref(from, computedFallback)
    router.push(backHref)
  }
  
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={handleBack}
      className={cn(
        "ui-component border-2 border-slate-600 text-slate-200 bg-slate-900/50",
        "hover:bg-slate-800 hover:border-slate-500 hover:text-white",
        "focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
        "transition-all duration-200 active:scale-95",
        "shadow-md hover:shadow-lg",
        className
      )}
      aria-label="Back"
      title="Back"
    >
      <ArrowLeft className="h-5 w-5" />
    </Button>
  )
}
