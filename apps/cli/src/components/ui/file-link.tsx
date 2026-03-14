import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Text } from "ink";
import Link from "ink-link";

interface FileLinkProps {
  path: string;
  label?: string;
}

export const FileLink = ({ path, label }: FileLinkProps) => {
  const absolutePath = resolve(path);
  const fileUrl = pathToFileURL(absolutePath).href;

  return (
    <Link url={fileUrl}>
      <Text>{label ?? absolutePath}</Text>
    </Link>
  );
};
