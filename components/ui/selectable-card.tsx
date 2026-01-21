"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Check, Lock } from "lucide-react"

type ModuleVariant = "rams" | "timesheet" | "inspection" | "absence" | "default"

interface SelectableCardProps {
  children: React.ReactNode
  selected?: boolean
  onSelect?: () => void
  disabled?: boolean
  locked?: boolean
  lockedMessage?: string
  variant?: ModuleVariant
  className?: string
}

const SelectableCard = React.forwardRef<HTMLDivElement, SelectableCardProps>(
  ({ 
    children, 
    selected = false, 
    onSelect, 
    disabled = false, 
    locked = false,
    lockedMessage,
    variant = "default",
    className,
    ...props 
  }, ref) => {
    const handleClick = () => {
      if (disabled || locked) return
      onSelect?.()
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        handleClick()
      }
    }

    return (
      <div
        ref={ref}
        role="button"
        tabIndex={disabled || locked ? -1 : 0}
        aria-pressed={selected}
        aria-disabled={disabled || locked}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "ui-component selectable-card relative flex items-center gap-3 p-3 rounded-lg transition-all duration-200",
          selected && `selectable-card-selected selectable-card-${variant}`,
          disabled && "selectable-card-disabled",
          locked && "selectable-card-locked",
          className
        )}
        {...props}
      >
        {/* Selection indicator */}
        <div 
          className={cn(
            "flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
            selected 
              ? "border-current bg-current" 
              : "border-slate-500 bg-transparent",
            locked && "border-green-500 bg-green-500"
          )}
        >
          {(selected || locked) && (
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {children}
        </div>

        {/* Lock indicator */}
        {locked && (
          <div className="flex-shrink-0 flex items-center gap-1 text-xs text-green-400 selectable-card-lock-icon">
            <Lock className="h-3 w-3" />
            {lockedMessage && <span>{lockedMessage}</span>}
          </div>
        )}
      </div>
    )
  }
)

SelectableCard.displayName = "SelectableCard"

export { SelectableCard }
export type { SelectableCardProps, ModuleVariant }
