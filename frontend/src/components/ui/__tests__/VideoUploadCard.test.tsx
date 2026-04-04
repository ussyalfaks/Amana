import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VideoUploadCard } from '../VideoUploadCard';

// Mock the BentoCard component
jest.mock('../BentoCard', () => ({
    BentoCard: ({ children, title, icon, glowVariant, className }: any) => (
        <div data-testid="bento-card" data-title={title} data-glow={glowVariant} className={className}>
            {children}
        </div>
    ),
}));

// Mock the Icon component
jest.mock('../Icon', () => ({
    Icon: ({ name, size, className, ...props }: any) => (
        <svg data-testid={`icon-${name}`} data-size={size} className={className} {...props} />
    ),
}));

// Mock XMLHttpRequest
const mockXhr = {
    upload: {
        onprogress: null as any,
    },
    onload: null as any,
    onerror: null as any,
    open: jest.fn(),
    setRequestHeader: jest.fn(),
    send: jest.fn(),
    status: 200,
    responseText: JSON.stringify({ IpfsHash: 'QmTest123' }),
    statusText: 'OK',
};

global.XMLHttpRequest = jest.fn(() => mockXhr) as any;

describe('VideoUploadCard Component', () => {
    const defaultProps = {
        onUpload: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockXhr.upload.onprogress = null;
        mockXhr.onload = null;
        mockXhr.onerror = null;
        mockXhr.status = 200;
        mockXhr.responseText = JSON.stringify({ IpfsHash: 'QmTest123' });
    });

    it('renders without crashing with all props', () => {
        const { container } = render(<VideoUploadCard {...defaultProps} />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('displays the evidence upload title', () => {
        render(<VideoUploadCard {...defaultProps} />);
        expect(screen.getByText('Evidence Upload')).toBeInTheDocument();
    });

    it('displays upload instruction text', () => {
        render(<VideoUploadCard {...defaultProps} />);
        expect(screen.getByText('Upload delivery proof video for verification')).toBeInTheDocument();
    });

    it('displays drag and drop instruction', () => {
        render(<VideoUploadCard {...defaultProps} />);
        expect(screen.getByText('Drag & drop or click to browse')).toBeInTheDocument();
    });

    it('renders the video icon', () => {
        const { container } = render(<VideoUploadCard {...defaultProps} />);
        const videoIcon = container.querySelector('svg');
        expect(videoIcon).toBeInTheDocument();
    });

    it('renders the file input', () => {
        const { container } = render(<VideoUploadCard {...defaultProps} />);
        const fileInput = container.querySelector('input[type="file"]');
        expect(fileInput).toBeInTheDocument();
    });

    it('accepts video file types', () => {
        const { container } = render(<VideoUploadCard {...defaultProps} />);
        const fileInput = container.querySelector('input[type="file"]');
        expect(fileInput).toHaveAttribute('accept', 'video/mp4,video/webm');
    });

    it('displays submit proof button', () => {
        render(<VideoUploadCard {...defaultProps} />);
        expect(screen.getByText('Submit Proof')).toBeInTheDocument();
    });

    it('disables submit button when no file is uploaded', () => {
        render(<VideoUploadCard {...defaultProps} />);
        const submitButton = screen.getByText('Submit Proof');
        expect(submitButton).toBeDisabled();
    });

    it('enables submit button after successful upload', async () => {
        render(<VideoUploadCard {...defaultProps} />);

        const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

        Object.defineProperty(fileInput, 'files', {
            value: [file],
        });

        fireEvent.change(fileInput);

        // Simulate successful upload
        await waitFor(() => {
            mockXhr.onload();
        });

        await waitFor(() => {
            const submitButton = screen.getByText('Submit Proof');
            expect(submitButton).not.toBeDisabled();
        });
    });

    it('displays upload progress when uploading', async () => {
        render(<VideoUploadCard {...defaultProps} />);

        const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

        Object.defineProperty(fileInput, 'files', {
            value: [file],
        });

        fireEvent.change(fileInput);

        // Simulate progress
        await waitFor(() => {
            if (mockXhr.upload.onprogress) {
                mockXhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
            }
        });

        await waitFor(() => {
            expect(screen.getByText('Uploading to IPFS…')).toBeInTheDocument();
            expect(screen.getByText('50%')).toBeInTheDocument();
        });
    });

    it('displays IPFS hash after successful upload', async () => {
        render(<VideoUploadCard {...defaultProps} />);

        const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

        Object.defineProperty(fileInput, 'files', {
            value: [file],
        });

        fireEvent.change(fileInput);

        // Simulate successful upload
        await waitFor(() => {
            mockXhr.onload();
        });

        await waitFor(() => {
            expect(screen.getByText('QmTest123')).toBeInTheDocument();
        });
    });

    it('calls onUpload callback after successful upload', async () => {
        const onUpload = jest.fn();
        render(<VideoUploadCard onUpload={onUpload} />);

        const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

        Object.defineProperty(fileInput, 'files', {
            value: [file],
        });

        fireEvent.change(fileInput);

        // Simulate successful upload
        await waitFor(() => {
            mockXhr.onload();
        });

        await waitFor(() => {
            expect(onUpload).toHaveBeenCalledWith('QmTest123');
        });
    });

    it('displays error message on upload failure', async () => {
        mockXhr.status = 500;
        mockXhr.statusText = 'Internal Server Error';

        render(<VideoUploadCard {...defaultProps} />);

        const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

        Object.defineProperty(fileInput, 'files', {
            value: [file],
        });

        fireEvent.change(fileInput);

        // Simulate failed upload
        await waitFor(() => {
            mockXhr.onload();
        });

        await waitFor(() => {
            expect(screen.getByText(/Upload failed/)).toBeInTheDocument();
        });
    });

    it('displays error message on network error', async () => {
        render(<VideoUploadCard {...defaultProps} />);

        const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

        Object.defineProperty(fileInput, 'files', {
            value: [file],
        });

        fireEvent.change(fileInput);

        // Simulate network error
        await waitFor(() => {
            mockXhr.onerror();
        });

        await waitFor(() => {
            expect(screen.getByText('Network error during upload')).toBeInTheDocument();
        });
    });

    it('handles file drop', async () => {
        render(<VideoUploadCard {...defaultProps} />);

        const dropZone = screen.getByText('Upload delivery proof video for verification').closest('div');
        const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });

        const dropEvent = new Event('drop', { bubbles: true });
        Object.defineProperty(dropEvent, 'dataTransfer', {
            value: {
                files: [file],
            },
        });

        fireEvent(dropZone!, dropEvent);

        // Verify upload started
        await waitFor(() => {
            expect(mockXhr.open).toHaveBeenCalled();
        });
    });

    it('handles file input change', async () => {
        render(<VideoUploadCard {...defaultProps} />);

        const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

        Object.defineProperty(fileInput, 'files', {
            value: [file],
        });

        fireEvent.change(fileInput);

        // Verify upload started
        await waitFor(() => {
            expect(mockXhr.open).toHaveBeenCalled();
        });
    });

    it('renders IPFS link after successful upload', async () => {
        render(<VideoUploadCard {...defaultProps} />);

        const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

        Object.defineProperty(fileInput, 'files', {
            value: [file],
        });

        fireEvent.change(fileInput);

        // Simulate successful upload
        await waitFor(() => {
            mockXhr.onload();
        });

        await waitFor(() => {
            const link = screen.getByLabelText('View on IPFS');
            expect(link).toHaveAttribute('href', 'https://gateway.pinata.cloud/ipfs/QmTest123');
        });
    });

    it('applies gold glow variant', () => {
        const { container } = render(<VideoUploadCard {...defaultProps} />);
        const card = container.querySelector('[data-testid="bento-card"]');
        expect(card).toHaveAttribute('data-glow', 'gold');
    });

    it('applies correct styling classes to the card', () => {
        const { container } = render(<VideoUploadCard {...defaultProps} />);
        const card = container.querySelector('[data-testid="bento-card"]');
        expect(card).toHaveClass('h-full');
    });
});
