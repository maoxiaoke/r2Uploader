import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useMemo } from "react";
import { ScrollArea } from "components/ui/scroll-area";
import { Button } from "components/ui/button";
import styl from "./index.module.css";
import { cn } from "lib/utils";
import {
  House,
  Search,
  Columns4,
  Upload,
  Loader2,
  RefreshCcw,
  Plus,
} from "lucide-react";
import { FileWithSkeleton } from "@/components/file-with-skeleton";
import { useBucketsContext } from "@/context/buckets";
import { FileUpload } from "@/components/file-upload";
import { SimpleUseTooltip } from "@/components/simple-use-tooltip";
import useMasonry from "../../hooks/useMasonry";
import { NoBuckets } from "@/components/no-buckets";
import { Spinner } from "@/components/spinner";
import toast, { Toaster } from "react-hot-toast";
import { usePlateform } from "@/hooks/usePlateform";

import type { UploadFile } from "@/components/file-upload";

export async function generateStaticParams() {
  return [{ name: "example" }];
}

interface BucketObject {
  etag: string;
  http_metadata: {
    contentType: string;
  };
  key: string;
  last_modified: string;
  size: number;
  storage_class: "standard";
}

export default function BucketPage() {
  const router = useRouter();
  const { isWindows } = usePlateform();
  const bucketName = router.query.name as string;
  const { buckets } = useBucketsContext();
  const currentBucket = buckets.find((bucket) => bucket.name === bucketName);

  const customDomain = useMemo(() => {
    const activeCustomDomain = (
      currentBucket?.domains?.custom?.domains ?? []
    ).filter((dom) => dom.enabled)[0];

    return activeCustomDomain?.domain;
  }, [currentBucket]);

  const [files, setFiles] = useState<BucketObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [cursor, setCursor] = useState({
    cursor: "",
    is_truncated: false,
  });

  const masonryContainer = useMasonry();

  useEffect(() => {
    if (!bucketName) {
      return;
    }

    setLoading(true);
    window.electron.ipc
      .invoke("cf-get-bucket-objects", {
        bucketName,
      })
      .then((data) => {
        setCursor(data?.result_info);

        setFiles(data?.result || []);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [bucketName]);

  const loadMore = () => {
    setIsLoadingMore(true);
    window.electron.ipc
      .invoke("cf-get-bucket-objects", {
        bucketName,
        cursor: cursor.cursor,
      })
      .then((data) => {
        setCursor(data?.result_info);

        setFiles((prev) => [...prev, ...(data?.result || [])]);
      })
      .finally(() => {
        setIsLoadingMore(false);
      });
  };

  const update = () => {
    window.electron.ipc
      .invoke("cf-get-bucket-objects", {
        bucketName,
      })
      .then((data) => {
        setCursor(data?.result_info);

        setFiles(data?.result || []);
      });
  };

  const appendFiles = (newFiles: UploadFile[]) => {
    setFiles((prev) => [
      ...newFiles.map((file) => ({
        etag: "",
        http_metadata: {
          contentType: file.file.type,
        },
        key: file.file.name,
        last_modified: new Date().toISOString(),
        size: file.file.size,
        storage_class: "standard" as const,
      })),
      ...prev,
    ]);
  };

  const onDelete = (object: string) => {
    setFiles((files) => files.filter((file) => file.key !== object));
  };

  return (
    <div className="no-drag">
      <header
        className={cn(
          "flex items-center justify-between px-4 w-screen",
          styl.headerHeight
        )}
      >
        {!isWindows ? (
          <div className="flex-1 drag opacity-0">hidden drag bar</div>
        ) : null}
        <div>
          <FileUpload bucket={bucketName} onClose={appendFiles}>
            <Button
              variant="outline"
              size="icon"
              className="bg-transparent shadow-none border-none"
            >
              <Upload />
            </Button>
          </FileUpload>

          <SimpleUseTooltip tips="Refresh current bucket">
            <Button
              variant="outline"
              size="icon"
              className="bg-transparent shadow-none border-none"
              onClick={update}
            >
              <RefreshCcw />
            </Button>
          </SimpleUseTooltip>

          <Button
            variant="outline"
            size="icon"
            className="bg-transparent shadow-none border-none"
          >
            <Search />
          </Button>

          {/* <Button
            variant="outline"
            size="icon"
            className="bg-transparent shadow-none border-none"
          >
            <Columns4 />
          </Button> */}

          <SimpleUseTooltip tips="Go home">
            <Button
              variant="outline"
              size="icon"
              asChild
              className="bg-transparent shadow-none border-none"
            >
              <Link href="/home?bucket=1" className="inline-block">
                <House />
              </Link>
            </Button>
          </SimpleUseTooltip>
        </div>
        {isWindows ? (
          <div className="flex-1 drag opacity-0">hidden drag bar</div>
        ) : null}
      </header>

      {loading && (
        <div className="flex items-center justify-center h-[500px] w-full">
          <Spinner />
        </div>
      )}

      {!loading && files.length === 0 && (
        <NoBuckets>
          <FileUpload bucket={bucketName} onClose={update}>
            <Button type="button" size="sm" className="mt-6 z-20">
              <Plus /> New Object
            </Button>
          </FileUpload>
        </NoBuckets>
      )}

      {!loading && files.length > 0 && (
        <div className="h-80 no-drag">
          <ScrollArea className={cn(styl.bodyHeight, "")}>
            <div
              className="p-4 grid items-start gap-4 grid-cols-4"
              ref={masonryContainer}
            >
              {files.map((file, idx) => (
                <FileWithSkeleton
                  bucket={bucketName}
                  key={file.key}
                  idx={idx}
                  file={file}
                  onDeleteFile={onDelete}
                  managedDomain={currentBucket?.domains?.managed?.domain}
                  customDomain={customDomain}
                />
              ))}
            </div>

            {cursor?.is_truncated ? (
              <div className="mb-4 w-full text-center no-drag">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => loadMore()}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="animate-spin ml-2" /> Please wait
                    </>
                  ) : (
                    <>Load more</>
                  )}
                </Button>
              </div>
            ) : null}
          </ScrollArea>
        </div>
      )}

      <Toaster />
    </div>
  );
}
