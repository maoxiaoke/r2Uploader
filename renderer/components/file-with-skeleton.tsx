import { useState } from "react";
import { cn, shortenPath } from "../lib/utils";
import { Skeleton } from "./ui/skeleton";
import { Badge } from "./ui/badge";
import { Copy } from "lucide-react";
import { useConfetti } from "@/hooks/useConfetti";
import { getFiletype } from "@/lib/utils";
import { FileTypeIcons } from "@/components/file-type-icons";
import { FileContextMenu } from "./file-context-menu";
import toast, { Toaster } from "react-hot-toast";

interface FileWithSkeletonProps {
  file: {
    etag: string;
    key: string;
    http_metadata: {
      contentType: string;
    };
  };
  idx: number;
  managedDomain: string;
  customDomain?: string;
  bucket: string;
  onDeleteFile: (object: string) => void;
}

export function FileWithSkeleton({
  file,
  bucket,
  idx,
  managedDomain,
  customDomain,
  onDeleteFile,
}: FileWithSkeletonProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [showCopy, setShowCopy] = useState(false);
  const { animate, confetti } = useConfetti();

  const fileType = getFiletype(file.http_metadata.contentType ?? "");

  const FileIcon = FileTypeIcons[fileType];

  const shareUrl = `https://${customDomain ?? managedDomain}/${file.key}`;

  const focusEle = (key: string) => {
    document.getElementById(key)?.focus();
  };

  const onExport = async () => {
    const success = await window.electron.ipc.invoke("export-file", {
      url: shareUrl,
    });

    if (success) {
      //
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

  const onCopy2Clipboard = () => {
    //
    window.electron.ipc.invoke("copy-2-clipboard", {
      url: shareUrl,
    });
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
          onExport={onExport}
          onOpenInBrowser={onOpenInBrowser}
          onCopyPath={onCopyPath}
          onDelete={onDelete}
          onCopy2Clipboard={onCopy2Clipboard}
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
                  isLoading ? "opacity-0" : "opacity-100"
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

      <div className="w-full text-center mt-1">
        <span
          className={`text-center inline-block text-secondary text-xs cursor-pointer hover:bg-[#f6f6f7] w-fit py-1 px-2 rounded transition-all duration-150 ease-in confetti-button ${animate}`}
          onMouseEnter={() => setShowCopy(true)}
          onMouseLeave={() => setShowCopy(false)}
          data-confetti-text="Copied!"
          onClick={() => {
            navigator.clipboard.writeText(shareUrl);
            confetti();
          }}
        >
          {shortenPath(file.key, 24)}{" "}
          <Copy
            className="inline-block ml-1"
            size="14"
            style={{
              visibility: showCopy ? "visible" : "hidden",
            }}
          />
        </span>
      </div>

      <Badge className="absolute top-1 left-1 opacity-50 rounded py-0 px-1 text-[10px]">
        {file.http_metadata?.contentType?.split("/")[1]?.toUpperCase()}
      </Badge>
    </div>
  );
}
