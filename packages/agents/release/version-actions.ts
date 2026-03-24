import { join } from 'node:path';
import {
  updateJson,
  type ProjectGraph,
  type ProjectGraphProjectNode,
  type Tree,
} from '@nx/devkit';
import type { VersionActions } from 'nx/release';
import type { NxReleaseVersionConfiguration } from 'nx/src/config/nx-json';
import type { ReleaseGroupWithName } from 'nx/src/command-line/release/config/filter-release-groups';
import type { FinalConfigForProject } from 'nx/src/command-line/release/utils/release-graph';

/**
 * INTERNAL NX IMPORTS — validated against Nx 22.x (@nx/js ^22.0.0, nx ^22.0.0)
 *
 * The following imports reference internal Nx paths because no public API
 * alternatives exist for these types/exports:
 *   - ReleaseGroupWithName (constructor param type)
 *   - FinalConfigForProject (constructor param type)
 *   - NxReleaseVersionConfiguration (type-only, for method signatures)
 *   - JsVersionActions class and afterAllProjectsVersioned (delegation target)
 *
 * If Nx restructures these paths in a future release, update the import paths
 * accordingly. The dynamic import of JsVersionActions is wrapped in try/catch
 * to surface a clear error message if this happens.
 */

// Re-export afterAllProjectsVersioned from @nx/js so lock-file updates still work
export { afterAllProjectsVersioned } from '@nx/js/src/release/version-actions';

// Type alias for the delegate — avoids importing the class at the module level
type JsVersionActionsInstance = VersionActions & {
  manifestsToUpdate: { manifestPath: string; preserveLocalDependencyProtocols: boolean }[];
};

/**
 * Custom Nx VersionActions for the agents package.
 *
 * Delegates to @nx/js's JsVersionActions for standard package.json operations,
 * then extends `updateProjectVersion` to also sync the version into:
 *   - .claude-plugin/plugin.json  (Claude Code plugin manifest)
 *   - skills/ocr/SKILL.md         (skill frontmatter metadata)
 *
 * This runs automatically during `nx release` as part of the version step,
 * so both files are always included in the release commit.
 */
export default class AgentsVersionActions implements VersionActions {
  releaseGroup: ReleaseGroupWithName;
  projectGraphNode: ProjectGraphProjectNode;
  finalConfigForProject: FinalConfigForProject;
  manifestsToUpdate: { manifestPath: string; preserveLocalDependencyProtocols: boolean }[] = [];

  validManifestFilenames = ['package.json'];

  private jsActions: JsVersionActionsInstance | undefined;

  constructor(
    releaseGroup: ReleaseGroupWithName,
    projectGraphNode: ProjectGraphProjectNode,
    finalConfigForProject: FinalConfigForProject,
  ) {
    this.releaseGroup = releaseGroup;
    this.projectGraphNode = projectGraphNode;
    this.finalConfigForProject = finalConfigForProject;
  }

  private async getJsActions(): Promise<JsVersionActionsInstance> {
    if (!this.jsActions) {
      try {
        const { default: JsVersionActions } = await import('@nx/js/src/release/version-actions');
        this.jsActions = new JsVersionActions(
          this.releaseGroup,
          this.projectGraphNode,
          this.finalConfigForProject,
        ) as JsVersionActionsInstance;
      } catch {
        throw new Error(
          'Failed to load @nx/js/src/release/version-actions. ' +
          'This is an internal Nx path validated against Nx 22.x. ' +
          'If you have upgraded Nx, the path may have changed — check the Nx changelog.',
        );
      }
    }
    return this.jsActions;
  }

  async init(tree: Tree): Promise<void> {
    const js = await this.getJsActions();
    await js.init(tree);
    this.manifestsToUpdate = js.manifestsToUpdate;
  }

  async validate(tree: Tree): Promise<void> {
    const js = await this.getJsActions();
    return js.validate(tree);
  }

  async readCurrentVersionFromSourceManifest(tree: Tree) {
    const js = await this.getJsActions();
    return js.readCurrentVersionFromSourceManifest(tree);
  }

  async readCurrentVersionFromRegistry(
    tree: Tree,
    metadata: NxReleaseVersionConfiguration['currentVersionResolverMetadata'],
  ) {
    const js = await this.getJsActions();
    return js.readCurrentVersionFromRegistry(tree, metadata);
  }

  async readDependencies(tree: Tree, projectGraph: ProjectGraph) {
    const js = await this.getJsActions();
    return js.readDependencies(tree, projectGraph);
  }

  async readCurrentVersionOfDependency(
    tree: Tree,
    projectGraph: ProjectGraph,
    dependencyProjectName: string,
  ) {
    const js = await this.getJsActions();
    return js.readCurrentVersionOfDependency(tree, projectGraph, dependencyProjectName);
  }

  async calculateNewVersion(
    currentVersion: string | null,
    newVersionInput: string,
    newVersionInputReason: string,
    newVersionInputReasonData: Record<string, unknown>,
    preid: string,
  ) {
    const js = await this.getJsActions();
    return js.calculateNewVersion(
      currentVersion,
      newVersionInput,
      newVersionInputReason,
      newVersionInputReasonData,
      preid,
    );
  }

  async updateProjectVersion(tree: Tree, newVersion: string): Promise<string[]> {
    const js = await this.getJsActions();
    const logMessages: string[] = await js.updateProjectVersion(tree, newVersion);

    const projectRoot: string = this.projectGraphNode.data.root;

    // Sync plugin.json
    const pluginJsonPath = join(projectRoot, '.claude-plugin', 'plugin.json');
    if (tree.exists(pluginJsonPath)) {
      updateJson(tree, pluginJsonPath, (json: Record<string, unknown>) => {
        json.version = newVersion;
        return json;
      });
      logMessages.push(
        `✍️  New version ${newVersion} written to ${pluginJsonPath}`,
      );
    }

    // Sync SKILL.md frontmatter
    const skillMdPath = join(projectRoot, 'skills', 'ocr', 'SKILL.md');
    if (tree.exists(skillMdPath)) {
      const content = tree.read(skillMdPath, 'utf-8');
      if (content == null) {
        logMessages.push(`⚠️  WARNING: could not read ${skillMdPath}`);
        return logMessages;
      }
      const updated = content.replace(
        /^(\s*version:\s*)"[^"]*"/m,
        `$1"${newVersion}"`,
      );
      if (updated === content) {
        logMessages.push(`⚠️  WARNING: version pattern not found in ${skillMdPath}`);
      } else {
        tree.write(skillMdPath, updated);
        logMessages.push(`✍️  New version ${newVersion} written to ${skillMdPath}`);
      }
    }

    return logMessages;
  }

  async updateProjectDependencies(
    tree: Tree,
    projectGraph: ProjectGraph,
    dependenciesToUpdate: Record<string, string>,
  ): Promise<string[]> {
    const js = await this.getJsActions();
    return js.updateProjectDependencies(tree, projectGraph, dependenciesToUpdate);
  }
}
