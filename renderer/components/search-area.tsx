import { Search, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Button } from "components/ui/button";
import { SimpleUseTooltip } from "@/components/simple-use-tooltip";

export const SearchArea = (props) => {
  const [showSearchInput, setShowSearchInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    props?.onChange?.(evt.target.value);
  };

  useEffect(() => {
    if (showSearchInput) {
      inputRef.current?.focus();
    }
  }, [showSearchInput]);

  if (!showSearchInput) {
    return (
      <SimpleUseTooltip tips="search objects with prefix">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setShowSearchInput(true)}
          className="bg-transparent shadow-none border-none"
        >
          <Search />
        </Button>
      </SimpleUseTooltip>
    );
  }

  return (
    <form className="flex items-center max-w-lg mx-auto no-drag">
      <label htmlFor="text-search" className="sr-only">
        Search
      </label>
      <div className="relative w-full">
        <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none">
          <Search size={16} />
        </div>
        <input
          type="text"
          ref={inputRef}
          id="text-search"
          className="border border-gray-300 text-secondary text-sm rounded-sm focus:outline-none focus:ring-ring focus:border-ring block w-full ps-8 p-1.5 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-ring dark:focus:border-ring"
          placeholder="Search..."
          required
          value={props.value}
          onChange={onChange}
        />
        <button
          type="button"
          onClick={() => {
            props.onChange("");
            setShowSearchInput(false);
          }}
          className="absolute inset-y-0 end-0 flex items-center pe-3"
        >
          <X size={16} />
        </button>
      </div>
    </form>
  );
};
