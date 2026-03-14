import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { useEffect, useRef } from "react";
import { Text, useStdout } from "ink";
import Link from "ink-link";
import { buildImageSequence } from "../../utils/build-image-sequence.js";
import {
  supportsKittyImages,
  supportsItermImages,
} from "../../utils/supports-inline-images.js";

interface ImageProps {
  src: string;
  alt?: string;
  width?: string | number;
  height?: string | number;
}

const SUPPORTS_INLINE_IMAGES = supportsKittyImages || supportsItermImages;

export const Image = ({ src, alt, width, height }: ImageProps) => {
  const absolutePath = resolve(src);
  const { write } = useStdout();
  const hasRendered = useRef(false);

  useEffect(() => {
    if (hasRendered.current) return;

    const sequence = buildImageSequence(absolutePath, { width, height });
    if (sequence) {
      write(sequence + "\n");
      hasRendered.current = true;
    }
  }, [absolutePath, width, height, write]);

  if (SUPPORTS_INLINE_IMAGES) {
    return null;
  }

  const fileUrl = pathToFileURL(absolutePath).href;
  const label = alt ?? absolutePath;

  return (
    <Link url={fileUrl}>
      <Text>{label}</Text>
    </Link>
  );
};
