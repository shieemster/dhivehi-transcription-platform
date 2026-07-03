// components/ui/popover.tsx
import * as React from "react"

interface PopoverContextType {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const PopoverContext = React.createContext<PopoverContextType | undefined>(undefined)

interface PopoverProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const Popover: React.FC<PopoverProps> = ({ children, open = false, onOpenChange }) => {
  return (
    <PopoverContext.Provider value={{ open, onOpenChange: onOpenChange || (() => {}) }}>
      <div className="relative inline-block w-full">{children}</div>
    </PopoverContext.Provider>
  )
}

const PopoverTrigger = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ children, asChild, ...props }, ref) => {
  const context = React.useContext(PopoverContext)
  
  return (
    <div
      ref={ref}
      onClick={() => context?.onOpenChange(!context.open)}
      {...props}
    >
      {children}
    </div>
  )
})
PopoverTrigger.displayName = "PopoverTrigger"

const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className = "", children, ...props }, ref) => {
  const context = React.useContext(PopoverContext)
  const contentRef = React.useRef<HTMLDivElement>(null)
  
  React.useEffect(() => {
    if (!context?.open) return

    const handleClickOutside = (event: MouseEvent) => {
      if (contentRef.current && !contentRef.current.contains(event.target as Node)) {
        context.onOpenChange(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [context])

  if (!context?.open) return null

  return (
    <div
      ref={(node) => {
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
        if (node) (contentRef as any).current = node
      }}
      className={`absolute z-50 w-full rounded-md border bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 shadow-md outline-none animate-in fade-in-0 zoom-in-95 mt-2 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
})
PopoverContent.displayName = "PopoverContent"

export { Popover, PopoverTrigger, PopoverContent }