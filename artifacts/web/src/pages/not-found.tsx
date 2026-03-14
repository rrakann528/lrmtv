import React from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="glass-panel p-12 rounded-3xl flex flex-col items-center text-center max-w-md">
        <AlertCircle className="w-16 h-16 text-destructive mb-6" />
        <h1 className="text-4xl font-display font-bold text-white mb-2 text-glow">404</h1>
        <p className="text-muted-foreground mb-8">
          The room or page you are looking for has been lost in the void.
        </p>
        <Link href="/" className="w-full">
          <Button size="lg" className="w-full">
            Return to Base
          </Button>
        </Link>
      </div>
    </div>
  );
}
