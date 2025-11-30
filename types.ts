export interface Dimensions {
  width: number;
  height: number;
}

export interface SplitImage {
  id: string;
  url: string;
  width: number;
  height: number;
}

export enum AppState {
  UPLOAD = 'UPLOAD',
  PROCESSING = 'PROCESSING',
  IMAGE_EDIT = 'IMAGE_EDIT',
  EDITOR = 'EDITOR',
  RESULTS = 'RESULTS',
}

export enum SplitDirection {
  HORIZONTAL = 'HORIZONTAL', // Horizontal lines, splitting Y-axis (Rows)
  VERTICAL = 'VERTICAL',     // Vertical lines, splitting X-axis (Columns)
}

export interface DetectedSplitsResponse {
  splitPoints: number[];
}