import { useConfetti } from "@/hooks/useConfetti";
import { useState } from "react";
import { Copy, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConfettiCopyTextProps = {
  text: string;
  shareUrl: string;
  className?: string;
  canEdit?: boolean;
  onEdit?: () => void;
}

export const ConfettiCopyText = ({ text, shareUrl, className, canEdit = false, onEdit }: ConfettiCopyTextProps) => {
  const { animate, confetti } = useConfetti();
  const [showCopy, setShowCopy] = useState(false);

  return (<div className="flex items-center" onMouseEnter={() => setShowCopy(true)}
  onMouseLeave={() => setShowCopy(false)}>
    <span
    className={cn(`text-center inline-block cursor-pointer hover:bg-[#f6f6f7] w-fit py-1 rounded transition-all duration-150 ease-in confetti-button ${animate}`, className)}
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

  </span>

  {
      canEdit ? (
        <Pencil
          className="inline-block ml-1 cursor-pointer"
          onClick={() => {
            onEdit?.();
          }}
      size="14"
      style={{
          visibility: showCopy ? "visible" : "hidden",
        }}
      />
    ) : null}
  </div>
);
};

