import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';

interface LoadingOverlayProps {
  message: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ message }) => {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-center p-4">
      <div className="relative">
        <div className="absolute inset-0 bg-purple-500 blur-xl opacity-20 rounded-full animate-pulse"></div>
        <Loader2 className="w-16 h-16 text-purple-400 animate-spin relative z-10" />
      </div>
      <h2 className="mt-6 text-2xl font-bold text-white flex items-center gap-2">
        <Sparkles className="w-6 h-6 text-yellow-400" />
        AI is working...
      </h2>
      <p className="mt-2 text-slate-300 text-lg">{message}</p>
    </div>
  );
};
