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
 * - Context-aware: respects ?from= query param when present
 * - Falls back to sitemap parent route
 */
export function BackButton({ className, userRole, fallbackHref }: BackButtonProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  
  const handleBack = () => {
    // Get the 'from' query parameter
    const from = searchParams.get('from')
    
    // Determine fallback parent
    const computedFallback = fallbackHref || getParentHref(pathname, userRole)
    
    // Get safe back href (validates 'from' param)
    const backHref = getBackHref(from, computedFallback)
    
    // Navigate to the determined route
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
