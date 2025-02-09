import { useConfetti } from "@/hooks/useConfetti";
import { useState } from "react";
import { Copy } from "lucide-react";
import { cn } from "@/lib/utils";


export const ConfettiCopyText = ({ text, shareUrl, className }: { text: string, shareUrl: string, className?: string }) => {
  const { animate, confetti } = useConfetti();
  const [showCopy, setShowCopy] = useState(false);

  return (<span
    className={cn(`text-center inline-block cursor-pointer hover:bg-[#f6f6f7] w-fit py-1 rounded transition-all duration-150 ease-in confetti-button ${animate}`, className)}
    onMouseEnter={() => setShowCopy(true)}
    onMouseLeave={() => setShowCopy(false)}
    data-confetti-text="Copied!"
    onClick={() => {
      navigator.clipboard.writeText(shareUrl);
      confetti();
    }}
  >
    {text}
    <Copy
      className="inline-block ml-1"
      size="14"
      style={{
        visibility: showCopy ? "visible" : "hidden",
      }}
    />
  </span>);
};

