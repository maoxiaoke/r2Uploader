import { ConfettiCopyText } from "./confetti-copy-text";
import type { ConfettiCopyTextProps } from "./confetti-copy-text";
import { useState, useRef, useEffect } from "react";

export const EditableConfettiCopyText = ({ text, shareUrl, className, canEdit = false, onChangeName }: ConfettiCopyTextProps & { onChangeName?: (newName: string, originalName: string) => Promise<void> }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(text);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();

    }
  }, [isEditing]);

  const changeName = async () => {
    setIsEditing(false);

    if (editedText !== text) {
      await onChangeName?.(editedText, text);
    }
  }

  if (isEditing && canEdit) {
    return (
      <input ref={inputRef} type="text" id="editable-confetti-copy-text" className="py-1 rounded-sm px-2" value={editedText} onChange={(e) => setEditedText(e.target.value)} onBlur={changeName}  onKeyDown={(e) => {
        if (e.key === "Enter") {
          changeName();
        }
      }} />
    );
  }

  return (
    <ConfettiCopyText text={text} shareUrl={shareUrl} className={className} canEdit={canEdit} onEdit={() => setIsEditing(true)} />
  );
};
