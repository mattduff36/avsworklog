"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils/cn"
import { Cross2Icon } from "@radix-ui/react-icons"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[200] bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  hideCloseButton?: boolean
  mobileKeyboardSafe?: boolean
}

type DialogContentSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl'
type DialogContentScroll = 'body' | 'content' | 'viewport'

interface DialogContentViewportClassNameOptions {
  size?: DialogContentSize
  scroll?: DialogContentScroll
  className?: string
}

interface DialogScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode
}

interface DialogVisualViewportStyle extends React.CSSProperties {
  '--dialog-visual-viewport-height'?: string
  '--dialog-visual-viewport-top'?: string
}

const DIALOG_CONTENT_SIZE_CLASSNAME: Record<DialogContentSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
}

const DIALOG_CONTENT_SCROLL_CLASSNAME: Record<DialogContentScroll, string> = {
  body: 'max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto',
  content: 'flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col overflow-hidden',
  viewport: 'max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)]',
}

function dialogContentViewportClassName({
  size,
  scroll = 'body',
  className,
}: DialogContentViewportClassNameOptions = {}) {
  return cn(
    DIALOG_CONTENT_SCROLL_CLASSNAME[scroll],
    size ? DIALOG_CONTENT_SIZE_CLASSNAME[size] : null,
    className,
  )
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideCloseButton = false, mobileKeyboardSafe = false, style, ...props }, ref) => {
  const [visualViewportStyle, setVisualViewportStyle] = React.useState<DialogVisualViewportStyle>({})

  React.useEffect(() => {
    if (!mobileKeyboardSafe) {
      setVisualViewportStyle({})
      return
    }

    const visualViewport = window.visualViewport
    function syncVisualViewport() {
      setVisualViewportStyle({
        '--dialog-visual-viewport-height': `${Math.max(0, visualViewport?.height ?? window.innerHeight)}px`,
        '--dialog-visual-viewport-top': `${visualViewport?.offsetTop ?? 0}px`,
      })
    }

    syncVisualViewport()
    visualViewport?.addEventListener('resize', syncVisualViewport)
    visualViewport?.addEventListener('scroll', syncVisualViewport)
    window.addEventListener('resize', syncVisualViewport)
    window.addEventListener('orientationchange', syncVisualViewport)

    return () => {
      visualViewport?.removeEventListener('resize', syncVisualViewport)
      visualViewport?.removeEventListener('scroll', syncVisualViewport)
      window.removeEventListener('resize', syncVisualViewport)
      window.removeEventListener('orientationchange', syncVisualViewport)
    }
  }, [mobileKeyboardSafe])

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-mobile-scroll-lock={mobileKeyboardSafe ? "true" : undefined}
        className={cn(
          "fixed left-[50%] top-[50%] z-[200] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-6 border-0 bg-slate-900 p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-xl text-slate-900 dark:text-slate-100",
          className,
          mobileKeyboardSafe && [
            "left-0 right-0 top-[var(--dialog-visual-viewport-top,0px)]",
            "flex h-[var(--dialog-visual-viewport-height,100dvh)] max-h-[var(--dialog-visual-viewport-height,100dvh)] min-h-0 w-auto translate-x-0 translate-y-0 flex-col overflow-hidden overscroll-contain rounded-none",
            "data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-2",
            "sm:left-[50%] sm:right-auto sm:top-[50%] sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-xl",
            "sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%] sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]",
          ]
        )}
        style={{ ...visualViewportStyle, ...style }}
        {...props}
      >
        {children}
        {!hideCloseButton && (
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <Cross2Icon className="h-4 w-4 text-slate-100" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogScrollArea = React.forwardRef<HTMLDivElement, DialogScrollAreaProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y",
        className
      )}
      {...props}
    />
  )
)
DialogScrollArea.displayName = "DialogScrollArea"

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight text-slate-900 dark:text-slate-100",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-slate-600 dark:text-slate-300", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogScrollArea,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  dialogContentViewportClassName,
}
