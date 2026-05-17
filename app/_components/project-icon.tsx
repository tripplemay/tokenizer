import { FaGithub, FaGitlab, FaBitbucket, FaGitAlt } from "react-icons/fa";
import { MdFolderOpen } from "react-icons/md";
import { describeRepoLink } from "@/shared/repo-link";

// Renders either a clickable git-host icon (links to the repo in a new tab)
// or a muted folder icon for projects without a git remote. Sits beside the
// project name in tables and headers so users can tell at a glance whether
// the project is git-tracked.
export function ProjectIcon({
  repoKey,
  workspacePath,
  size = "sm",
  folderTitle = "Local-only project (no git remote)"
}: {
  repoKey: string | null | undefined;
  workspacePath?: string | null;
  size?: "sm" | "md";
  folderTitle?: string;
}) {
  const sizeClass = size === "md" ? "h-5 w-5" : "h-4 w-4";
  const link = describeRepoLink(repoKey);

  if (!link) {
    return (
      <span
        title={workspacePath ? `${folderTitle}\n${workspacePath}` : folderTitle}
        className={`inline-flex items-center justify-center text-gray-400 dark:text-gray-500 ${sizeClass}`}
      >
        <MdFolderOpen className={sizeClass} />
      </span>
    );
  }

  const Icon = link.host === "github" ? FaGithub : link.host === "gitlab" ? FaGitlab : link.host === "bitbucket" ? FaBitbucket : FaGitAlt;

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer noopener"
      title={link.url}
      className={`inline-flex items-center justify-center text-gray-500 transition-colors hover:text-brand-500 dark:text-gray-400 dark:hover:text-brand-300 ${sizeClass}`}
      aria-label={`Open ${link.label} on ${link.host}`}
    >
      <Icon className={sizeClass} />
    </a>
  );
}
