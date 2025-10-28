import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { lookup } from 'mime-types';

export class DirectoryScanner {
	async scanDirectory(dirPath: string): Promise<string[]> {
		const textFiles: string[] = [];
		await this._scanRecursive(dirPath, textFiles);
		return textFiles;
	}

	private async _scanRecursive(currentPath: string, textFiles: string[]): Promise<void> {
		try {
			const entries = await readdir(currentPath, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = join(currentPath, entry.name);

				if (entry.isDirectory()) {
					// Skip node_modules and .git directories for performance
					if (entry.name !== 'node_modules' && entry.name !== '.git') {
						await this._scanRecursive(fullPath, textFiles);
					}
				} else if (entry.isFile()) {
					if (this._isTextFile(fullPath)) {
						textFiles.push(fullPath);
					}
				}
			}
		} catch (error) {
			console.warn(`Warning: Could not read directory ${currentPath}: ${error}`);
		}
	}

	private _isTextFile(filePath: string): boolean {
		const mimeType = lookup(filePath);
		if (mimeType && mimeType.startsWith('text/')) {
			return true;
		}

		// Additional check for common source code extensions that mime-types may not recognize as text
		const textExtensions = [
			'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
			'.py', '.java', '.cpp', '.c', '.h', '.hpp',
			'.go', '.rs', '.php', '.rb', '.swift', '.kt',
			'.scala', '.clj', '.hs', '.ml', '.fs',
			'.sh', '.bash', '.zsh', '.fish', '.ps1',
			'.yaml', '.yml', '.toml', '.ini', '.cfg',
			'.json', '.xml', '.svg', '.md', '.rst',
			'.sql', '.graphql', '.gql'
		];

		const ext = extname(filePath).toLowerCase();
		return textExtensions.includes(ext);
	}
}
