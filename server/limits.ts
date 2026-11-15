// A legal 121-row graph regression includes full replay traces and can exceed 4 MiB.
// Reserve envelope space so every stored experiment can be exported and imported.
export const MAX_REQUEST_BYTES=16*1024*1024;
export const MAX_EXPERIMENT_BYTES=MAX_REQUEST_BYTES-4096;
