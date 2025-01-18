import { useState } from "react";

export const useConfetti = () => {
  const [animate, setAnimate] = useState("");

  const confetti = () => {
    setAnimate("animate");
    setTimeout(() => {
      setAnimate("");
    }, 1000);
  };

  return { confetti, animate };
};
