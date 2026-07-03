// components/ui/slider.tsx
import * as React from "react"

export interface SliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value?: number[]
  onValueChange?: (value: number[]) => void
  min?: number
  max?: number
  step?: number
  // Color customization props
  filledColor?: string
  unfilledColor?: string
  thumbColor?: string
  thumbBorderColor?: string
  darkFilledColor?: string
  darkUnfilledColor?: string
  darkThumbColor?: string
  darkThumbBorderColor?: string
}

const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  ({ 
    className = "", 
    value = [0], 
    onValueChange, 
    min = 0, 
    max = 100, 
    step = 1,
    // Default light mode colors
    filledColor = 'rgb(87 83 78)', // stone-600
    unfilledColor = 'rgb(229 231 235)', // gray-200
    thumbColor = 'white', // inverted - now white inside
    thumbBorderColor = 'rgb(87 83 78)', // inverted - now stone-600 border
    // Default dark mode colors
    darkFilledColor = 'rgb(255 255 255)', // white
    darkUnfilledColor = 'rgb(64 64 64)', // neutral-700
    darkThumbColor = 'rgb(38 38 38)', // inverted - now dark inside
    darkThumbBorderColor = 'rgb(255 255 255)', // inverted - now white border
    ...props 
  }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (onValueChange) {
        onValueChange([Number(e.target.value)])
      }
    }
    
    const percentage = ((value[0] - min) / (max - min)) * 100

    return (
      <div ref={ref} className={`relative flex w-full touch-none select-none items-center ${className}`}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value[0]}
          onChange={handleChange}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer slider-thumb"
          style={{
            background: `linear-gradient(to right, ${filledColor} 0%, ${filledColor} ${percentage}%, ${unfilledColor} ${percentage}%, ${unfilledColor} 100%)`
          }}
          {...props}
        />
        <style jsx>{`
          .slider-thumb::-webkit-slider-thumb {
            appearance: none;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: ${thumbColor};
            cursor: pointer;
            border: 2px solid ${thumbBorderColor};
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            transition: all 0.2s ease-in-out;
          }
          .slider-thumb::-webkit-slider-thumb:hover {
            transform: scale(1.1);
          }
          .slider-thumb::-moz-range-thumb {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: ${thumbColor};
            cursor: pointer;
            border: 2px solid ${thumbBorderColor};
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            transition: all 0.2s ease-in-out;
          }
          .slider-thumb::-moz-range-thumb:hover {
            transform: scale(1.1);
          }
         
          /* Dark mode styles */
          :global(.dark) .slider-thumb {
            background: linear-gradient(to right, ${darkFilledColor} 0%, ${darkFilledColor} ${percentage}%, ${darkUnfilledColor} ${percentage}%, ${darkUnfilledColor} 100%) !important;
          }
          :global(.dark) .slider-thumb::-webkit-slider-thumb {
            background: ${darkThumbColor};
            border: 2px solid ${darkThumbBorderColor};
          }
          :global(.dark) .slider-thumb::-moz-range-thumb {
            background: ${darkThumbColor};
            border: 2px solid ${darkThumbBorderColor};
          }
        `}</style>
      </div>
    )
  }
)

Slider.displayName = "Slider"
export { Slider }