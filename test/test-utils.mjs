import { readFile } from 'node:fs/promises';

export async function readJSONFile(filePath) {
  try {
    const data = await readFile(filePath, 'utf8');
    const jsonData = JSON.parse(data);
    return jsonData;
  } catch (err) {
    console.error('Error reading file:', err);
    throw err;
  }
}
