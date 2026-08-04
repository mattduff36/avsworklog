import * as React from "react"
import { Search } from "lucide-react"

import { cn } from "@/lib/utils/cn"

interface SearchInputProps extends React.ComponentProps<"input"> {
  containerClassName?: string
  iconClassName?: string
}

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, containerClassName, iconClassName, disabled, type = "text", ...props }, ref) => {
    return (
      <div
        className={cn(
          "ui-component flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-foreground ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          disabled && "cursor-not-allowed opacity-50",
          containerClassName
        )}
      >
        <Search
          aria-hidden="true"
          className={cn("mr-2 h-4 w-4 shrink-0 text-muted-foreground", iconClassName)}
        />
        <input
          type={type}
          className={cn(
            // Keep 16px on compact mobile roots so iOS does not zoom focused inputs.
            "min-w-0 flex-1 bg-transparent p-0 text-[16px] text-foreground outline-none placeholder:text-slate-400 disabled:cursor-not-allowed md:text-sm dark:placeholder:text-slate-400",
            className
          )}
          disabled={disabled}
          ref={ref}
          {...props}
        />
      </div>
    )
  }
)
SearchInput.displayName = "SearchInput"

export { SearchInput }
