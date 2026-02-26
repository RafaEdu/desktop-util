import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "base",
        "surface",
        "field",
        "subtle",
        "fg",
        "fg-2",
        "fg-3",
        "fg-4",
        "fg-5",
        "fg-6",
        "fg-7",
        "fg-8",
        "edge",
        "edge-2",
        "edge-3",
        "accent",
      ],
    },
  },
});

export function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}
