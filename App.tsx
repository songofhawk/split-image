import React, { useState } from 'react';
import { Dimensions, AppState, SplitImage, SplitDirection } from './types';
import { ImageUploader } from './components/ImageUploader';
import { SplitEditor } from './components/SplitEditor';
import { ImageEditor } from './components/ImageEditor';
import { ResultGallery } from './components/ResultGallery';
import { LoadingOverlay } from './components/LoadingOverlay';
import { detectSeamsLocal } from './services/localSplitService';
import { Layers, Scissors } from 'lucide-react';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.UPLOAD);
  const [originalImageSrc, setOriginalImageSrc] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<Dimensions>({ width: 0, height: 0 });

  // Independent state for rows (y-coords) and cols (x-coords)
  const [rowSplits, setRowSplits] = useState<number[]>([]);
  const [colSplits, setColSplits] = useState<number[]>([]);

  const [resultImages, setResultImages] = useState<SplitImage[]>([]);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Helper to load image dimensions
  const loadImage = (file: File) => {
    setLoadingMessage("Reading image file...");
    setState(AppState.PROCESSING);
    setErrorMsg(null);

    // Reset state
    setRowSplits([]);
    setColSplits([]);

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setImageDimensions({ width: img.width, height: img.height });
        setOriginalImageSrc(img.src);
        // Initial process
        processImage(img.src, img.width, img.height);
      };
      img.onerror = () => {
        setErrorMsg("Failed to load image.");
        setState(AppState.UPLOAD);
        setLoadingMessage(null);
      };
      if (e.target?.result) {
        img.src = e.target.result as string;
      }
    };
    reader.readAsDataURL(file);
  };

  const processImage = async (src: string, w: number, h: number) => {
    setLoadingMessage("Detecting grid...");

    try {
      const { rowSplits, colSplits } = await detectSeamsLocal(src, w, h);

      setRowSplits(rowSplits);
      setColSplits(colSplits);

      setState(AppState.EDITOR);
    } catch (err) {
      console.error(err);
      setErrorMsg("Detection failed. You can manually split.");
      setState(AppState.EDITOR);
    } finally {
      setLoadingMessage(null);
    }
  };

  const handleReRunDetection = () => {
    if (originalImageSrc) {
      processImage(originalImageSrc, imageDimensions.width, imageDimensions.height);
    }
  };

  const executeSplits = (finalRowSplits: number[], finalColSplits: number[]) => {
    if (!originalImageSrc) return;
    setLoadingMessage("Cutting images...");
    setState(AppState.PROCESSING);

    const img = new Image();
    img.onload = () => {
      const rowPoints = [0, ...finalRowSplits.sort((a, b) => a - b), imageDimensions.height];
      const colPoints = [0, ...finalColSplits.sort((a, b) => a - b), imageDimensions.width];

      const newImages: SplitImage[] = [];

      // Create a reusable canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Double loop to handle the grid
      for (let r = 0; r < rowPoints.length - 1; r++) {
        const yStart = rowPoints[r];
        const yEnd = rowPoints[r + 1];
        const h = yEnd - yStart;

        if (h <= 0) continue;

        for (let c = 0; c < colPoints.length - 1; c++) {
          const xStart = colPoints[c];
          const xEnd = colPoints[c + 1];
          const w = xEnd - xStart;

          if (w <= 0) continue;

          canvas.width = w;
          canvas.height = h;

          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(
            img,
            xStart, yStart, w, h, // source rect
            0, 0, w, h            // dest rect
          );

          newImages.push({
            id: `split-${r}-${c}-${Date.now()}`,
            url: canvas.toDataURL('image/png'),
            width: w,
            height: h
          });
        }
      }

      setResultImages(newImages);
      setLoadingMessage(null);
      setState(AppState.RESULTS);
    };
    img.src = originalImageSrc;
  };

  const handleReset = () => {
    setState(AppState.UPLOAD);
    setOriginalImageSrc(null);
    setRowSplits([]);
    setColSplits([]);
    setResultImages([]);
    setErrorMsg(null);
  };

  const handleEditImage = () => {
    setState(AppState.IMAGE_EDIT);
  };

  const handleImageSave = (newSrc: string) => {
    const img = new Image();
    img.onload = () => {
      setImageDimensions({ width: img.width, height: img.height });
      setOriginalImageSrc(newSrc);
      // Re-run detection on the new image
      processImage(newSrc, img.width, img.height);
    };
    img.src = newSrc;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-gradient-to-br from-cyan-500 to-blue-600 p-2 rounded-lg">
              <Scissors className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              SplitStitch
            </h1>
          </div>
          <div className="text-sm text-slate-500">
            Local Processing
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-4 relative">
        {loadingMessage && <LoadingOverlay message={loadingMessage} />}

        <div className="flex-1 flex flex-col items-center justify-center w-full">

          {state === AppState.UPLOAD && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 w-full flex flex-col items-center">
              <div className="text-center mb-12 max-w-2xl">
                <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">
                  Smartly split your <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
                    stitched images
                  </span>
                </h2>
                <p className="text-lg text-slate-400 leading-relaxed">
                  Upload a long screenshot, collage, or sprite sheet.
                  Local algorithm detects boundaries to split the image into a grid.
                </p>
              </div>
              <ImageUploader onImageSelected={loadImage} />
              {errorMsg && <p className="text-red-400 mt-4">{errorMsg}</p>}
            </div>
          )}

          {state === AppState.EDITOR && originalImageSrc && (
            <div className="w-full h-full animate-in fade-in duration-300">
              <SplitEditor
                imageSrc={originalImageSrc}
                dimensions={imageDimensions}
                rowSplits={rowSplits}
                colSplits={colSplits}
                onConfirm={executeSplits}
                onCancel={handleReset}
                onReRunDetection={handleReRunDetection}
                onSplitsChange={(rows, cols) => {
                  setRowSplits(rows);
                  setColSplits(cols);
                }}
                onEditImage={handleEditImage}
              />
            </div>
          )}

          {state === AppState.IMAGE_EDIT && originalImageSrc && (
            <div className="w-full h-full animate-in fade-in duration-300">
              <ImageEditor
                imageSrc={originalImageSrc}
                onSave={handleImageSave}
                onCancel={() => setState(AppState.EDITOR)}
              />
            </div>
          )}

          {state === AppState.RESULTS && (
            <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
              <ResultGallery images={resultImages} onReset={handleReset} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;