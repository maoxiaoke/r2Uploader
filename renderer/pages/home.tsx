import React, { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Logo from "./logo";
import { Input } from "../components/ui/Input";
import { Button } from "@/components/ui/button";
import { CircleHelp, ArrowRight, Trash2, Rocket, Loader2 } from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import { useConfigContext } from "@/context/config";
import { useBucketsContext } from "@/context/buckets";
import { CreateBucket } from "@/components/create-bucket";
import { DeleteBucket } from "@/components/delete-bucket";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function HomePage() {
  const [logined, setLogined] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [r2Token, setR2Token] = useState("");
  const [license, setLicense] = useState("");
  const [loading, setLoading] = useState(false);
  const [licenseLoading, setLicenseLoading] = useState(false);
  const { buckets, setBuckets } = useBucketsContext();

  const router = useRouter();
  const { config } = useConfigContext();

  if (config?.accountId && !accountId) {
    setAccountId(config.accountId);
  }

  if (config?.r2Token && !r2Token) {
    setR2Token(config.r2Token);
  }

  if (config?.license && !license) {
    setLicense(config.license);
  }

  useEffect(() => {
    setLoading(true);

    (async () => {
      const data = await window.electron.ipc.invoke("cf-get-buckets", {
        cacheOnly: false,
      });

      if (data.success) {
        setLogined(true);

        (data.result?.buckets ?? []).length && setBuckets(data.result.buckets);

        // if (!router.query.bucket) {
        //   const existLastOpenedBucket =
        //     config?.lastOpenedBucket &&
        //     (data.result?.buckets ?? []).some(
        //       (bucket) => bucket.name === config.lastOpenedBucket
        //     );

        //   if (existLastOpenedBucket) {
        //     router.push(`/bucket/${config.lastOpenedBucket}`);
        //   }
        // }
      }

      setLoading(false);
    })();
  }, []);

  const launch = async () => {
    if (!accountId || !r2Token) {
      toast.error("Please enter your CloudFlare account id and r2 token", {
        style: {
          fontSize: "13px",
        },
      });
      return;
    }

    if (!config.activated || !config.license) {
      toast.error("Please activate your license key", {
        style: {
          fontSize: "13px",
        },
      });
      return;
    }

    // save account id and r2 token
    await window.electron.ipc.invoke("set-config", {
      accountId,
      r2Token,
    });

    // get buckets
    const data = await window.electron.ipc.invoke("cf-get-buckets", {});

    const buckets = data?.result?.buckets ?? [];

    if (buckets.length === 0) {
      toast.error("No buckets found", {
        style: {
          fontSize: "13px",
        },
      });
      return;
    }

    setBuckets(buckets);

    setLogined(true);
  };

  const openBucket = async (bucketName: string) => {
    // Save last opened bucket
    window.electron.ipc.invoke("set-config", {
      lastOpenedBucket: bucketName,
    });

    const isManagedDomainEnabled = buckets.find(
      (bucket) => bucket.name === bucketName
    )?.domains?.managed?.enabled;

    if (!isManagedDomainEnabled) {
      // Enable managed domain
      await window.electron.ipc.invoke("cf-enable-managed-domain", {
        bucketName,
      });
    }

    router.push(`/bucket/${bucketName}`);
  };

  const create = async () => {
    await window.electron.ipc.invoke("cf-create-bucket", {
      bucketName: "test",
    });
  };

  const activateLicense = async () => {
    setLicenseLoading(true);

    await window.electron.ipc.invoke("activate-license", {
      license_key: license,
    });

    setLicenseLoading(false);
  };

  const deactivateLicense = async () => {
    setLicenseLoading(true);

    await window.electron.ipc.invoke("deactivate-license", {
      license_key: license,
    });

    setLicenseLoading(false);
  };

  return (
    <React.Fragment>
      <Head>
        <title>R2 Uploader</title>
      </Head>
      <div className="flex items-center justify-center flex-col text-2xl w-full text-center relative no-drag text-secondary">
        <div className="flex flex-col items-center mt-20">
          <Logo style={{ fontSize: "100px" }} />
          <div
            style={{
              fontFamily: "Solway",
            }}
            className="text-primary"
          >
            R2 Uploader
          </div>
        </div>

        {loading ? (
          <Loader2 className="animate-spin mt-10" />
        ) : (
          <>
            {logined ? (
              <>
                <div className="mt-5">
                  <CreateBucket>
                    <Button onClick={create}>
                      Create a new bucket <ArrowRight />
                    </Button>
                  </CreateBucket>
                </div>

                <span className="text-primary text-sm mt-10">
                  or open an existing bucket
                </span>

                {buckets.length ? (
                  <>
                    <ScrollArea className="mt-5 h-28">
                      {buckets.map((bucket) => (
                        <div
                          className="flex items-center justify-between bg-white rounded-md px-3 py-1 border-none shadow-sm transition-colors text-primary text-base mt-1 first:mt-0"
                          key={bucket.name}
                        >
                          <span>{bucket.name}</span>

                          <div className="flex items-center">
                            <DeleteBucket
                              bucketName={bucket.name}
                              onError={(errMsg) => {
                                toast.error(errMsg, {
                                  style: {
                                    fontSize: "13px",
                                  },
                                });
                              }}
                            >
                              <Button
                                variant="outline"
                                size="icon"
                                className="rounded-full ml-10 border-none shadow-none"
                              >
                                <Trash2 />
                              </Button>
                            </DeleteBucket>

                            <Button
                              className="ml-2"
                              size="sm"
                              onClick={() => openBucket(bucket.name)}
                            >
                              Open
                            </Button>
                          </div>
                        </div>
                      ))}
                    </ScrollArea>
                  </>
                ) : (
                  <div className="text-xs mt-5 bg-white p-2 rounded-md">
                    No existing buckets found.
                    <br />
                    Start by creating a new bucket.
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mt-5">
                  <div className="flex flex-col w-full items-start gap-1.5">
                    <label className="text-sm">Account Id</label>
                    <Input
                      className="focus:bg-white focus:bg-opacity-80 bg-white bg-opacity-60"
                      value={accountId}
                      onChange={(e) => {
                        setAccountId(e.target.value);
                      }}
                    />
                  </div>

                  <div className="flex flex-col w-full items-start gap-1.5 mt-2">
                    <label className="text-sm">R2 Token</label>
                    <Input
                      className="focus:bg-white focus:bg-opacity-80 bg-white bg-opacity-60"
                      value={r2Token}
                      onChange={(e) => {
                        setR2Token(e.target.value);
                      }}
                    />
                  </div>

                  <div className="flex flex-col w-full items-start gap-1.5 mt-4">
                    <div className="flex items-center">
                      <label className="text-sm">License Key</label>
                      <CircleHelp size={14} className="inline-block ml-2" />
                      <Button
                        variant="link"
                        className="pl-1 text-xs"
                        onClick={() => {
                          window.electron.ipc.invoke("open-browser", {
                            url: "https://anotherme.lemonsqueezy.com/buy/f9d4edca-2436-4247-a567-9002fb95a8e8",
                          });
                        }}
                      >
                        Get license key
                      </Button>
                    </div>
                    <div className="flex w-full max-w-sm items-center space-x-2">
                      <Input
                        disabled={config?.activated}
                        value={license}
                        placeholder="Enter your license key"
                        onChange={(e) => {
                          setLicense(e.target.value);
                        }}
                        className="focus:bg-white focus:bg-opacity-80 bg-white bg-opacity-60"
                      />
                      {config?.activated ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={deactivateLicense}
                        >
                          {licenseLoading ? (
                            <Loader2 className="animate-spin ml-2" />
                          ) : null}{" "}
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={activateLicense}
                          disabled={!license}
                        >
                          {licenseLoading ? (
                            <Loader2 className="animate-spin ml-2" />
                          ) : null}
                          Activate
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <Button className="mt-5" onClick={launch}>
                  Launch
                  <Rocket className="inline-block ml-2" />
                </Button>
              </>
            )}
          </>
        )}

        <div className="mt-5">
          <Button
            variant="link"
            onClick={() => {
              window.electron.ipc.invoke("open-browser", {
                url: "https://github.com/maoxiaoke/r2Uploader?tab=readme-ov-file#tutorial",
              });
            }}
          >
            Tutorial
          </Button>
          <Button
            variant="link"
            onClick={() => {
              window.electron.ipc.invoke("open-browser", {
                url: "https://x.com/xiaokedada",
              });
            }}
          >
            About Me
          </Button>
          <Button
            variant="link"
            onClick={() => {
              window.electron.ipc.invoke("open-browser", {
                url: "https://github.com/maoxiaoke/r2Uploader",
              });
            }}
          >
            Github
          </Button>
        </div>
      </div>

      <Toaster />
    </React.Fragment>
  );
}
