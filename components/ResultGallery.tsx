import React, { useState, useEffect } from 'react';
import { Download, ArrowLeft, CheckCircle, Copy, Check, X } from 'lucide-react';
import { SplitImage } from '../types';

interface ResultGalleryProps {
  images: SplitImage[];
  onReset: () => void;
}

export const ResultGallery: React.FC<ResultGalleryProps> = ({ images, onReset }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<SplitImage | null>(null);

  // 监听 ESC 键关闭预览
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewImage(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  const downloadImage = (url: string, index: number) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `split-image-${index + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadAll = () => {
    images.forEach((img, idx) => {
      // Stagger downloads slightly to prevent browser blocking
      setTimeout(() => downloadImage(img.url, idx), idx * 200);
    });
  };

  const copyImageToClipboard = async (url: string, index: number, e: React.MouseEvent) => {
    e.stopPropagation(); // 防止触发图片预览
    try {
      // 将 base64 URL 转换为 Blob
      const response = await fetch(url);
      const blob = await response.blob();

      // 使用 Clipboard API 复制图片
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ]);

      // 显示复制成功提示
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy image:', err);
      alert('Failed to copy image to clipboard. Please try downloading instead.');
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-4">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <CheckCircle className="text-green-400" />
            Done! {images.length} Images Created
          </h2>
          <p className="text-slate-400 mt-1">Review and download your split images.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onReset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-slate-300 border border-slate-700 hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Start Over
          </button>
          <button
            onClick={downloadAll}
            className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold shadow-lg shadow-green-900/20 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download All
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {images.map((img, index) => (
          <div key={img.id} className="group relative bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-purple-500/50 transition-all hover:shadow-xl hover:shadow-purple-900/20">
            <div className="absolute top-2 left-2 bg-black/60 backdrop-blur px-2 py-1 rounded text-xs font-mono text-slate-300 z-10">
              #{index + 1}
            </div>

            {/* 复制成功提示 */}
            {copiedIndex === index && (
              <div className="absolute top-2 right-2 bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 z-10 animate-in fade-in slide-in-from-top-2">
                <Check className="w-3 h-3" />
                Copied!
              </div>
            )}

            <div
              className="h-64 w-full overflow-hidden bg-slate-950/50 flex items-center justify-center p-2 cursor-pointer hover:bg-slate-900/50 transition-colors"
              onClick={() => setPreviewImage(img)}
              title="Click to preview"
            >
              <img
                src={img.url}
                alt={`Result ${index + 1}`}
                className="max-w-full max-h-full object-contain shadow-sm"
              />
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-900/80 group-hover:bg-slate-800/80 transition-colors flex justify-between items-center">
              <span className="text-xs text-slate-500">{img.width}×{img.height}px</span>
              <div className="flex gap-2">
                <button
                  onClick={(e) => copyImageToClipboard(img.url, index, e)}
                  className="p-2 rounded-full hover:bg-purple-500/20 text-purple-400 hover:text-purple-300 transition-colors"
                  title="Copy to clipboard"
                >
                  {copiedIndex === index ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => downloadImage(img.url, index)}
                  className="p-2 rounded-full hover:bg-orange-500/20 text-orange-400 hover:text-orange-300 transition-colors"
                  title="Download this image"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 图片预览模态框 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setPreviewImage(null)}
        >
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-full transition-colors z-10"
            title="Close (ESC)"
          >
            <X className="w-6 h-6" />
          </button>

          <div
            className="relative max-w-[90vw] max-h-[90vh] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewImage.url}
              alt="Preview"
              className="max-w-full max-h-[90vh] object-contain shadow-2xl rounded-lg"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 rounded-b-lg">
              <p className="text-white text-sm text-center">
                {previewImage.width} × {previewImage.height}px
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
