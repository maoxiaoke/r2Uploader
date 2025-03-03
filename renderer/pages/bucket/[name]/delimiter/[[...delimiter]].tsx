import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useMemo } from "react";
import { ScrollArea } from "components/ui/scroll-area";
import { Button } from "components/ui/button";
import styl from "./index.module.css";
import { cn } from "lib/utils";
import { useDebounce } from "@uidotdev/usehooks";
import {
  House,
  Search,
  Columns4,
  Upload,
  Loader2,
  RefreshCcw,
  Plus,
  CircleChevronLeft,
} from "lucide-react";
import { FileWithSkeleton } from "@/components/file-with-skeleton";
import { useBucketsContext } from "@/context/buckets";
import { FileUpload } from "@/components/file-upload";
import { SimpleUseTooltip } from "@/components/simple-use-tooltip";
import useMasonry from "@/hooks/useMasonry";
import { NoBuckets } from "@/components/no-buckets";
import toast, { Toaster } from "react-hot-toast";
import { usePlateform } from "@/hooks/usePlateform";
import { SearchArea } from "@/components/search-area";
import { shortenPath } from '@/lib/utils'

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
  const delimiterNames = router.query.delimiter as (string[] | undefined);
  const { buckets } = useBucketsContext();
  const currentBucket = buckets.find((bucket) => bucket.name === bucketName);
  const [prefix, setPrefix] = useState("");

  const debouncedPrefix = useDebounce<string>(prefix, 500);

  const prefixByDelimiterAndSearch = useMemo(() => {
    if (delimiterNames) {
      return delimiterNames.join('/') + '/' + debouncedPrefix;
    }

    return '';
  }, [delimiterNames, debouncedPrefix]);

  const customDomain = useMemo(() => {
    const activeCustomDomain = (
      currentBucket?.domains?.custom?.domains ?? []
    ).filter((dom) => dom.enabled)[0];

    return activeCustomDomain?.domain;
  }, [currentBucket]);

  const publicDomain = `https://${customDomain ?? currentBucket?.domains?.managed?.domain}`;

  const [files, setFiles] = useState<BucketObject[]>([]);
  const [delimiters, setDelimiters] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [cursor, setCursor] = useState({
    cursor: "",
    is_truncated: false,
  });

  const masonryContainer = useMasonry();
  const hasDelimiters = delimiters.length > 0;

  useEffect(() => {
    if (!bucketName) {
      return;
    }

    setLoading(true);
    window.electron.ipc
      .invoke("cf-get-bucket-objects", {
        bucketName,
        prefix: prefixByDelimiterAndSearch
      })
      .then((data) => {
        setCursor(data?.result_info);

        setFiles(data?.result || []);
        setDelimiters(data?.result_info?.delimited || []);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [bucketName, prefixByDelimiterAndSearch]);

  const loadMore = () => {
    setIsLoadingMore(true);
    window.electron.ipc
      .invoke("cf-get-bucket-objects", {
        bucketName,
        cursor: cursor.cursor,
        prefix: prefixByDelimiterAndSearch
      })
      .then((data) => {
        setCursor(data?.result_info);

        setFiles((prev) => [...prev, ...(data?.result || [])]);
        setDelimiters((prev) => [...prev, ...(data?.result_info?.delimited || [])]);
      })
      .finally(() => {
        setIsLoadingMore(false);
      });
  };

  const update = () => {
    window.electron.ipc
      .invoke("cf-get-bucket-objects", {
        bucketName,
        prefix: prefixByDelimiterAndSearch
      })
      .then((data) => {
        setCursor(data?.result_info);

        setFiles(data?.result || []);
        setDelimiters(data?.result_info?.delimited || []);
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
          "flex items-center justify-between px-4 w-screen relative",
          styl.headerHeight
        )}
      >
        <div className="flex items-center ml-20">
        <Button
              variant="link"
              size="icon"
              className="bg-transparent shadow-none border-none text-primary"
              disabled={!delimiterNames?.length}
              onClick={() => {
                if (delimiterNames?.length === 1) {
                  router.push(`/bucket/${bucketName}/delimiter`);
                  return;
                }

                const slicedDelimiterNames = delimiterNames?.slice(0, -1).join('/');
                router.push(`/bucket/${bucketName}/delimiter/${slicedDelimiterNames}`);
              }}
            >
                <CircleChevronLeft />
            </Button>
        <div className="text-sm">{delimiterNames ? delimiterNames.join('/') : 'root'}</div>
        </div>
        {!isWindows ? (
          <div className="flex-1 drag opacity-0">hidden drag bar</div>
        ) : null}
        <div className="flex items-center">
          <FileUpload bucket={bucketName} onClose={appendFiles} publicDomain={publicDomain}>
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

          <SearchArea onChange={(prefix) => setPrefix(prefix)} value={prefix} />

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
          <Loader2 className="animate-spin" />
        </div>
      )}

      {!loading && files.length === 0 && (
        <NoBuckets>
          <FileUpload bucket={bucketName} onClose={update} publicDomain={publicDomain}>
            <Button type="button" size="sm" className="mt-6 z-20">
              <Plus /> New Object
            </Button>
          </FileUpload>
        </NoBuckets>
      )}

      {!loading && files.length > 0 && (
        <div className="h-80 no-drag">
          <ScrollArea className={cn(styl.bodyHeight, "")}>
          {hasDelimiters ? (
        <div className="no-drag p-4">
          <div className="text-sm">Folders ({delimiters.length})</div>
          <div className="flex gap-4 mt-4">
            {delimiters.map((dir) => (
              <div key={dir} className="cursor-pointer" onClick={() => {
                const withoutSlash = dir.split('/').filter(Boolean).join('/');
                router.push(`/bucket/${bucketName}/delimiter/${withoutSlash}`);
              }}>
                <div className="flex w-32 flex-col items-center">
                  <div className="h-1.5 w-4/5 rounded-tl rounded-tr bg-[#A0ABC5]"></div>
                  <div className="aspect-3/2 h-24 w-full rounded bg-[#68748D]" ></div>
                  <div className="text-xs text-center text-secondary mt-1">{shortenPath(dir.split('/').filter(Boolean).slice(-1)[0], 20)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

            {
              hasDelimiters ? (<div className="text-sm pl-4 mt-2">Objects ({files.length})</div>): null
            }
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
                  publicDomain={publicDomain}
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
