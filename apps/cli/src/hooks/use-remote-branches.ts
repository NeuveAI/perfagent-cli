import { useQuery } from "@tanstack/react-query";
import type { RemoteBranch } from "@neuve/shared/models";
import { fetchRemoteBranches } from "../utils/context-options";

export const useRemoteBranches = () =>
  useQuery({
    queryKey: ["remote-branches"],
    queryFn: (): Promise<RemoteBranch[]> => fetchRemoteBranches(process.cwd()),
  });
