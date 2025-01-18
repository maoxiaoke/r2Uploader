/**
 * useMasonry hook
 * This hook is copied from https://cruip.com/how-to-create-a-true-masonry-with-nextjs/
 * https://tobiasahlin.com/blog/masonry-with-css/ is good, but it doesn't work dynamical height
 * https://github.com/jaredLunde/masonic is good, but it calculates the wrong height of the item
 */

import { useEffect, useState, useRef } from "react";

const useMasonry = () => {
  const masonryContainer = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<ChildNode[]>([]);

  useEffect(() => {
    if (masonryContainer.current) {
      const masonryItem = Array.from(masonryContainer.current.children);
      setItems(masonryItem);
    }
  }, []);

  useEffect(() => {
    const handleMasonry = () => {
      if (!items || items.length < 1) return;
      let gapSize = 0;
      if (masonryContainer.current) {
        gapSize = parseInt(
          window
            .getComputedStyle(masonryContainer.current)
            .getPropertyValue("grid-row-gap")
        );
      }
      items.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        let previous = el.previousSibling;
        while (previous) {
          if (previous.nodeType === 1) {
            el.style.marginTop = "0";
            if (
              previous instanceof HTMLElement &&
              elementLeft(previous) === elementLeft(el)
            ) {
              el.style.marginTop =
                -(elementTop(el) - elementBottom(previous) - gapSize) + "px";
              break;
            }
          }
          previous = previous.previousSibling;
        }
      });
    };

    handleMasonry();
    window.addEventListener("resize", handleMasonry);
    return () => {
      window.removeEventListener("resize", handleMasonry);
    };
  }, [items]);

  const elementLeft = (el: HTMLElement) => {
    return el.getBoundingClientRect().left;
  };

  const elementTop = (el: HTMLElement) => {
    return el.getBoundingClientRect().top + window.scrollY;
  };

  const elementBottom = (el: HTMLElement) => {
    return el.getBoundingClientRect().bottom + window.scrollY;
  };

  return masonryContainer;
};

export default useMasonry;
