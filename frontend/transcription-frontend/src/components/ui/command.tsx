// components/ui/command.tsx
import * as React from "react"

const Command = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className = "", ...props }, ref) => (
  <div
    ref={ref}
    className={`flex h-full w-full flex-col overflow-hidden rounded-md bg-white dark:bg-neutral-800 text-stone-900 dark:text-white ${className}`}
    {...props}
  />
))
Command.displayName = "Command"

const CommandInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className = "", ...props }, ref) => (
  <div className="flex items-center border-b border-stone-200 dark:border-neutral-700 px-3">
    <input
      ref={ref}
      className={`flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-stone-500 dark:placeholder:text-neutral-400 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  </div>
))
CommandInput.displayName = "CommandInput"

const CommandList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className = "", ...props }, ref) => (
  <div
    ref={ref}
    className={`max-h-[300px] overflow-y-auto overflow-x-hidden ${className}`}
    {...props}
  />
))
CommandList.displayName = "CommandList"

const CommandEmpty = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className = "", ...props }, ref) => (
  <div
    ref={ref}
    className={`py-6 text-center text-sm text-stone-600 dark:text-neutral-400 ${className}`}
    {...props}
  />
))
CommandEmpty.displayName = "CommandEmpty"

const CommandGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className = "", ...props }, ref) => (
  <div
    ref={ref}
    className={`overflow-hidden p-1 text-stone-900 dark:text-white ${className}`}
    {...props}
  />
))
CommandGroup.displayName = "CommandGroup"

const CommandItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    onSelect?: (value: string) => void
    value?: string
  }
>(({ className = "", onSelect, value, ...props }, ref) => {
  const handleSelect = () => {
    if (onSelect && value) {
      onSelect(value)
    }
  }

  return (
    <div
      ref={ref}
      className={`relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-stone-100 dark:hover:bg-neutral-700 transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${className}`}
      onClick={handleSelect}
      {...props}
    />
  )
})
CommandItem.displayName = "CommandItem"

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
}