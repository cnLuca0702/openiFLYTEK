import { parentPort, workerData } from 'node:worker_threads';
import { readDocument } from './document_reader.js';
try {parentPort.postMessage({pages:await readDocument(workerData.file,workerData.ext,workerData.dir)});}
catch(error) {parentPort.postMessage({error:error.message});}
