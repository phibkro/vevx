export interface FileContent {
    path: string;
    relativePath: string;
    language: string;
    content: string;
    size: number;
}
/**
 * Discover all code files in the given path (file or directory)
 */
export declare function discoverFiles(targetPath: string): Promise<FileContent[]>;
//# sourceMappingURL=discovery-node.d.ts.map