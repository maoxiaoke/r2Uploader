import { useState, useEffect } from "react";
import { cn, shortenPath } from "../lib/utils";
import { Skeleton } from "./ui/skeleton";
import { Badge } from "./ui/badge";
import { getFiletype } from "@/lib/utils";
import { FileTypeIcons } from "@/components/file-type-icons";
import { FileContextMenu } from "./file-context-menu";
import toast, { Toaster } from "react-hot-toast";
import { ConfettiCopyText } from "./confetti-copy-text";

interface FileWithSkeletonProps {
  file: {
    etag: string;
    key: string;
    http_metadata: {
      contentType: string;
    };
  };
  idx: number;
  publicDomain: string;
  bucket: string;
  onDeleteFile: (object: string) => void;
}

export function FileWithSkeleton({
  file,
  bucket,
  idx,
  publicDomain,
  onDeleteFile,
}: FileWithSkeletonProps) {
  const [isLoading, setIsLoading] = useState(true);

  const fileType = getFiletype(file.http_metadata.contentType ?? "");
  const FileIcon = FileTypeIcons[fileType];
  const shareUrl = `${publicDomain}/${file.key}`;
  const [isOpen, setIsOpen] = useState(false);

  const focusEle = (key: string) => {
    document.getElementById(key)?.focus();
  };

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isThisElementFocused = activeElement?.id === file.key;
      
      if (isThisElementFocused && (e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault();
        await onCopy2Clipboard();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [file.key]);

  const onExport = async () => {
    const success = await window.electron.ipc.invoke("export-file", {
      url: shareUrl,
    });

    if (success) {
      toast.success("file is exported!", {
        style: {
          fontSize: "13px",
        },
      });
    }
  };

  const onOpenInBrowser = () => {
    window.electron.ipc.invoke("open-browser", {
      url: shareUrl,
    });
  };

  const onCopyPath = () => {
    navigator.clipboard.writeText(shareUrl);
    toast.success("File path is copied to your clipboard!", {
      style: {
        fontSize: "13px",
      },
    });
  };

  const onDelete = async () => {
    const sure2delete = await window.electron.ipc.invoke(
      "show-message-box-sync",
      {
        message: "Are you sure to delete?",
        detail: `Deleting ${shortenPath(
          file.key,
          34
        )} from nazha-online is permanent and cannot be undone.`,
        type: "warning",
      }
    );

    if (sure2delete === 0) {
      const res = await window.electron.ipc.invoke("cf-delete-object", {
        bucket,
        object: file.key,
      });

      if (res.success) {
        onDeleteFile(file.key);
        return;
      }

      toast.error("Fail to delete!", {
        style: {
          fontSize: "13px",
        },
      });
    }
  };

  const onCopy2Clipboard = async () => {
    const success = await window.electron.ipc.invoke("copy-2-clipboard", {
      url: shareUrl,
      copyFileType: fileType === "image" ? "image" : "text",
    });

    if (success) {
      toast.success("file content is copied to your clipboard!", {
        style: {
          fontSize: "13px",
        },
      });
    }
  };

  return (
    <div className="mb-4 break-inside-avoid relative">
      <div
        className="relative"
        style={{
          minHeight: isLoading ? "150px" : "auto",
        }}
      >
        <FileContextMenu
          onOpenChange={(op) => setIsOpen(op)}
          onExport={onExport}
          onOpenInBrowser={onOpenInBrowser}
          onCopyPath={onCopyPath}
          onDelete={onDelete}
          onCopy2Clipboard={onCopy2Clipboard}
          showCopy2Clipboard={["text", "image", "json"].includes(fileType)}
        >
          {fileType === "image" ? (
            <>
              {isLoading && (
                <Skeleton className="absolute inset-0 w-full h-[150px] rounded-sm bg-gray-400" />
              )}
              <img
                src={shareUrl}
                alt={file.key}
                className={cn(
                  "w-full rounded-sm bg-[#E7E7E7] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                  isLoading ? "opacity-0" : "opacity-100",
                  isOpen ? 'outline-none ring-2 ring-ring ring-offset-2' : ''
                )}
                loading="lazy"
                id={file.key}
                tabIndex={idx}
                onLoad={() => setIsLoading(false)}
                onError={() => setIsLoading(false)}
                onClick={() => focusEle(file.key)}
              />
            </>
          ) : (
            <div
              id={file.key}
              tabIndex={idx}
              className="w-full aspect-[1/1] flex items-center justify-center text-6xl bg-[#E7E7E7] rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              onClick={() => focusEle(file.key)}
            >
              <FileIcon />
            </div>
          )}
        </FileContextMenu>
      </div>

      <div className="w-full text-center mt-1 flex items-center justify-center">
        <ConfettiCopyText text={shortenPath(file.key?.split('/').pop() ?? '', 24)} shareUrl={shareUrl} className="text-xs text-secondary px-2"  />
      </div>

      <Badge className="absolute top-1 left-1 opacity-50 rounded py-0 px-1 text-[10px]">
        {file.http_metadata?.contentType?.split("/")[1]?.toUpperCase()}
      </Badge>
    </div>
  );
}
