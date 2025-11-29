import { useState, useEffect } from "react";
import { Skeleton } from "./ui/skeleton";
import { cn } from "../lib/utils";
import { CirclePlay } from "lucide-react";
import { BucketObject } from "../../shared/types";

export type BaseRendererProps = {
  isLoading?: boolean;
  setIsLoading?: (isLoading: boolean) => void;
  file: BucketObject;
  shareUrl: string;
  isOpen: boolean;
  focusEle: (key: string) => void;
  idx: number;
};

export const FileRenderer = ({
  isLoading,
  setIsLoading,
  fileType,
  file,
  shareUrl,
  isOpen,
  focusEle,
  idx,
}: BaseRendererProps & {
  fileType: string;
}) => {
  return (
    <>
      {isLoading && (
        <Skeleton className="absolute inset-0 w-full h-[150px] rounded-sm bg-gray-400" />
      )}
      {fileType === "image" ? (
        <ImageRenderer
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          file={file}
          shareUrl={shareUrl}
          isOpen={isOpen}
          focusEle={focusEle}
          idx={idx}
        />
      ) : (
        <VideoRenderer
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          file={file}
          shareUrl={shareUrl}
          isOpen={isOpen}
          focusEle={focusEle}
          idx={idx}
        />
      )}
    </>
  );
};

export const ImageRenderer = ({
  isLoading,
  setIsLoading,
  file,
  shareUrl,
  isOpen,
  focusEle,
  idx,
}: BaseRendererProps) => {
  return (
    <img
      src={shareUrl}
      alt={file.key}
      className={cn(
        "w-full rounded-sm bg-[#E7E7E7] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        isLoading ? "opacity-0" : "opacity-100",
        isOpen ? "outline-none ring-2 ring-ring ring-offset-2" : ""
      )}
      loading="lazy"
      id={file.key}
      tabIndex={idx}
      onLoad={() => setIsLoading(false)}
      onError={() => setIsLoading(false)}
      onClick={() => focusEle(file.key)}
    />
  );
};

export const VideoRenderer = ({
  isLoading,
  setIsLoading,
  file,
  shareUrl,
  isOpen,
  focusEle,
  idx,
}: BaseRendererProps) => {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    setIsLoading(false);
  }, []);

  if (!isPlaying) {
    return (
      <div
        id={file.key}
        tabIndex={idx}
        className="w-full aspect-[1/1] flex items-center justify-center text-6xl bg-[#E7E7E7] rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        onClick={() => focusEle(file.key)}
      >
        <CirclePlay
          size={48}
          color="#7dc4e4"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setIsPlaying(true);
          }}
        />
      </div>
    );
  }

  return (
    <video
      src={shareUrl}
      className={cn(
        "w-full rounded-sm bg-[#E7E7E7] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        isOpen ? "outline-none ring-2 ring-ring ring-offset-2" : ""
      )}
      id={file.key}
      autoPlay={true}
      muted={true}
      tabIndex={idx}
      onClick={() => focusEle(file.key)}
    />
  );
};
