const { createApp, ref, computed } = Vue;

const app = createApp({
    setup() {
        // Reactive state
        const currentStep = ref(1);
        const steps = ref(['Select Photos', 'Face Detection', 'Group Formation']);
        const processedPhotos = ref([]);
        const failedPhotos = ref([]);
        const groups = ref([]);
        const unmatchedGroups = ref([]);
        const isProcessing = ref(false);
        const processingProgress = ref(0);
        const processedCount = ref(0);
        const totalPhotos = ref(0);
        const files = ref([]);
        const selectedFilter = ref('all');
        const startTime = ref(null);
        const estimatedTimeRemaining = ref(null);
        const elapsedTime = ref(0);
        const selectedPhoto = ref(null);
        const showGroupFilesModal = ref(false);
        const selectedGroup = ref(null);

        // Computed properties
        const photosWithFaces = computed(() => processedPhotos.value.filter(p => p.metadata.hasFace).length);
        const photosWithoutFaces = computed(() => processedPhotos.value.filter(p => !p.metadata.hasFace).length);
        const matchedGroups = computed(() => Math.floor(groups.value.length * 0.8));

        const formatTime = (seconds) => {
            if (seconds < 60) return `${Math.round(seconds)} seconds`;
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = Math.round(seconds % 60);
            return `${minutes} minute${minutes !== 1 ? 's' : ''} ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
        };

        // Filtered photos based on selected filter
        const filteredPhotos = computed(() => {
            switch (selectedFilter.value) {
                case 'face':
                    return processedPhotos.value.filter(p => p.metadata.hasFace);
                case 'noFace':
                    return processedPhotos.value.filter(p => !p.metadata.hasFace);
                case 'failed':
                    return failedPhotos.value;
                default:
                    return processedPhotos.value;
            }
        });

        // Sort photos by confidence distance from 0.5
        const sortedPhotos = computed(() => {
            return [...filteredPhotos.value].sort((a, b) => {
                const aDist = Math.abs((a.metadata.confidence || 0) - 0.5);
                const bDist = Math.abs((b.metadata.confidence || 0) - 0.5);
                return aDist - bDist;
            });
        });

        // Methods
        const handleFileSelect = async (event) => {
            const selectedFiles = Array.from(event.target.files);
            // Update files ref to show just the count
            files.value = [new File([], `${selectedFiles.length} photos selected`, { type: 'text/plain' })];
            await processFiles(selectedFiles);
        };

        const handleDrop = async (event) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer.files);
            await processFiles(files);
        };

        const processFiles = async (files) => {
            isProcessing.value = true;
            totalPhotos.value = files.length;
            processedCount.value = 0;
            processingProgress.value = 0;
            startTime.value = Date.now();
            elapsedTime.value = 0;

            // Keep the count display
            files.value = [new File([], `${files.length} photos selected`, { type: 'text/plain' })];

            // Process files sequentially to show progress
            for (const file of files) {
                try {
                    const photo = await processPhoto(file);
                    processedPhotos.value.push(photo);
                    processedCount.value++;
                    processingProgress.value = (processedCount.value / totalPhotos.value) * 100;
                    
                    // Update elapsed and estimated time remaining
                    if (startTime.value) {
                        const currentTime = Date.now();
                        elapsedTime.value = (currentTime - startTime.value) / 1000;
                        if (processedCount.value > 1) {
                            const timePerPhoto = elapsedTime.value / processedCount.value;
                            const remainingPhotos = totalPhotos.value - processedCount.value;
                            estimatedTimeRemaining.value = timePerPhoto * remainingPhotos;
                        }
                    }
                } catch (error) {
                    console.error('Error processing photo:', error);
                    failedPhotos.value.push({
                        file,
                        error: error.message
                    });
                    processedCount.value++;
                    processingProgress.value = (processedCount.value / totalPhotos.value) * 100;
                }
            }

            isProcessing.value = false;
            currentStep.value = 2;
        };

        const processPhoto = async (file) => {
            // Resize image
            const resizedImage = await resizeAndCropImage(file);
            
            // Read EXIF data
            const timestamp = await readExifData(file);
            
            // Create photo object
            const photo = {
                originalFile: file,
                processedImage: resizedImage,
                processedImageUrl: URL.createObjectURL(resizedImage),
                metadata: {
                    originalPath: file.webkitRelativePath || file.name,
                    timestamp,
                    hasFace: null,
                    faceEmbedding: null,
                    error: null
                }
            };

            // Detect face
            try {
                await detectFaceAndGetEmbedding(photo);
            } catch (error) {
                console.warn('Face detection failed:', error);
                photo.metadata.hasFace = false;
                photo.metadata.faceEmbedding = null;
            }

            return photo;
        };

        const startAnalysis = async () => {
            currentStep.value = 2;
            // Face detection is already done during processing
        };

        const exportGroupInfo = () => {
            const data = {
                groups: groups.value.map(group => ({
                    id: group.id,
                    hasFace: group.hasFace,
                    hasMatches: group.hasMatches,
                    photos: group.photos.map(photo => ({
                        path: photo.metadata.originalPath,
                        timestamp: photo.metadata.timestamp,
                        hasFace: photo.metadata.hasFace
                    })),
                    matches: group.matches.map(match => ({
                        groupId: match.group.id,
                        similarity: match.similarity,
                        photos: match.group.photos.map(photo => ({
                            path: photo.metadata.originalPath,
                            timestamp: photo.metadata.timestamp,
                            hasFace: photo.metadata.hasFace
                        }))
                    }))
                }))
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'group-info.json';
            a.click();
            URL.revokeObjectURL(url);
        };

        const exportSelectedPhotos = () => {
            // This would be implemented based on your specific export requirements
            console.log('Exporting selected photos...');
        };

        // Helper functions
        const resizeAndCropImage = (file) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    // Set canvas size to 300x300
                    canvas.width = 300;
                    canvas.height = 300;
                    
                    // Calculate dimensions for center crop
                    const sourceSize = Math.min(img.width, img.height);
                    const sourceX = (img.width - sourceSize) / 2;
                    const sourceY = (img.height - sourceSize) / 2;
                    
                    // Draw the cropped and resized image
                    ctx.drawImage(
                        img,
                        sourceX, sourceY, sourceSize, sourceSize,
                        0, 0, 300, 300
                    );
                    
                    // Convert to blob
                    canvas.toBlob(blob => {
                        if (blob) {
                            const resizedFile = new File([blob], file.name, {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            });
                            resolve(resizedFile);
                        } else {
                            reject(new Error('Failed to create blob'));
                        }
                    }, 'image/jpeg', 0.9);
                };
                img.onerror = reject;
                img.src = URL.createObjectURL(file);
            });
        };

        const readExifData = (file) => {
            return new Promise((resolve) => {
                EXIF.getData(file, function() {
                    const dateTime = EXIF.getTag(this, "DateTimeOriginal") || 
                                    EXIF.getTag(this, "DateTime") || 
                                    EXIF.getTag(this, "DateTimeDigitized");
                    
                    if (dateTime) {
                        // Convert EXIF date string to Date object
                        const [date, time] = dateTime.split(' ');
                        const [year, month, day] = date.split(':');
                        const [hour, minute, second] = time.split(':');
                        const timestamp = new Date(year, month - 1, day, hour, minute, second);
                        resolve(timestamp);
                    } else {
                        resolve(null);
                    }
                });
            });
        };

        const detectFaceAndGetEmbedding = async (photo) => {
            try {
                const img = await new Promise((resolve, reject) => {
                    const image = new Image();
                    image.onload = () => resolve(image);
                    image.onerror = reject;
                    image.src = URL.createObjectURL(photo.processedImage);
                });

                // Use SSD Mobilenet v1 for better accuracy
                const detections = await faceapi.detectSingleFace(img, new faceapi.SsdMobilenetv1Options({
                    minConfidence: 0.8,
                    maxResults: 1
                }))
                .withFaceLandmarks()
                .withFaceDescriptor();

                if (detections) {
                    photo.metadata.hasFace = true;
                    photo.metadata.faceEmbedding = Array.from(detections.descriptor);
                    photo.metadata.confidence = detections.detection.score;
                } else {
                    photo.metadata.hasFace = false;
                    photo.metadata.faceEmbedding = null;
                    photo.metadata.confidence = 0;
                }

                URL.revokeObjectURL(img.src);
            } catch (error) {
                console.error('Error detecting face:', error);
                photo.metadata.hasFace = false;
                photo.metadata.faceEmbedding = null;
                photo.metadata.confidence = 0;
                throw error;
            }
        };

        const toggleFaceDetection = (photo) => {
            photo.metadata.hasFace = !photo.metadata.hasFace;
            // If toggling to no face, clear the embedding
            if (!photo.metadata.hasFace) {
                photo.metadata.faceEmbedding = null;
            }
        };

        // Load face-api.js models
        const loadModels = async () => {
            try {
                await Promise.all([
                    faceapi.nets.ssdMobilenetv1.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models'),
                    faceapi.nets.tinyFaceDetector.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models'),
                    faceapi.nets.faceLandmark68Net.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models'),
                    faceapi.nets.faceRecognitionNet.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models')
                ]);
                console.log('Face API models loaded successfully');
            } catch (error) {
                console.error('Error loading face API models:', error);
                throw error;
            }
        };

        // Initialize models when the app starts
        loadModels().catch(error => {
            console.error('Failed to initialize face detection:', error);
        });

        // Helper functions for grouping and matching
        const cosineSimilarity = (a, b) => {
            if (!a || !b) return 0;
            const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
            const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
            const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
            return dotProduct / (magnitudeA * magnitudeB);
        };

        const areGroupsConnected = (beforeGroup, afterGroup) => {
            // Find matching groups for each group
            const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
            const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
            const SIMILARITY_THRESHOLD = 0.97;

            const beforeEndTime = Math.max(...beforeGroup.photos.map(p => p.metadata.timestamp));
            const afterStartTime = Math.min(...afterGroup.photos.map(p => p.metadata.timestamp));
            const timeDiff = afterStartTime - beforeEndTime;

            // Check time constraints
            if (!(timeDiff >= ONE_WEEK && timeDiff <= ONE_YEAR)) {
                return false;
            }

            // Check if there's a face match between the groups
            const beforeFacePhotos = beforeGroup.photos.filter(p => p.metadata.hasFace);
            const afterFacePhotos = afterGroup.photos.filter(p => p.metadata.hasFace);
            
            if (beforeFacePhotos.length === 0 || afterFacePhotos.length === 0) {
                return false;
            }

            // Calculate maximum similarity between any face photos in the two groups
            const maxSimilarity = Math.max(...beforeFacePhotos.flatMap(facePhoto =>
                afterFacePhotos.map(otherFacePhoto =>
                    cosineSimilarity(facePhoto.metadata.faceEmbedding, otherFacePhoto.metadata.faceEmbedding)
                )
            ));

            return maxSimilarity >= SIMILARITY_THRESHOLD;
        };

        const groupByTime = async () => {
            isProcessing.value = true;
            processingProgress.value = 0;
            totalPhotos.value = processedPhotos.value.length + failedPhotos.value.length;
            processedCount.value = 0;

            // Sort photos by timestamp
            const sortedPhotos = [...processedPhotos.value].sort((a, b) => 
                a.metadata.timestamp - b.metadata.timestamp
            );

            // Create time-based groups
            const timeGroups = [];
            let currentGroup = [];
            const TEN_MINUTES = 10 * 60 * 1000; // 10 minutes in milliseconds

            for (const photo of sortedPhotos) {
                if (currentGroup.length === 0) {
                    currentGroup.push(photo);
                } else {
                    const lastPhoto = currentGroup[currentGroup.length - 1];
                    const timeDiff = photo.metadata.timestamp - lastPhoto.metadata.timestamp;
                    
                    if (timeDiff <= TEN_MINUTES) {
                        currentGroup.push(photo);
                    } else {
                        if (currentGroup.length > 0) {
                            timeGroups.push({
                                photos: currentGroup,
                                hasFace: currentGroup.some(p => p.metadata.hasFace)
                            });
                        }
                        currentGroup = [photo];
                    }
                }
                processedCount.value++;
                processingProgress.value = (processedCount.value / totalPhotos.value) * 100;
            }
            if (currentGroup.length > 0) {
                timeGroups.push({
                    photos: currentGroup,
                    hasFace: currentGroup.some(p => p.metadata.hasFace)
                });
            }

            // Filter groups to keep only those with both face and non-face photos
            const filteredGroups = timeGroups
                .filter(group => {
                    const hasFace = group.photos.some(p => p.metadata.hasFace);
                    const hasNoFace = group.photos.some(p => !p.metadata.hasFace);
                    return hasFace && hasNoFace;
                })
                .sort((a, b) => {
                    const aTime = a.photos[0].metadata.timestamp;
                    const bTime = b.photos[0].metadata.timestamp;
                    return aTime - bTime;
                });

            // Going to chain filteredGroups to each other.
            const chains = [];
            let usedGroups = new Set();

            for (let i = 0; i < filteredGroups.length; i++) {
                if (usedGroups.has(i)) {
                    continue;
                }

                const chain = [filteredGroups[i]];
                usedGroups.add(i);

                for (let j = i + 1; j < filteredGroups.length; j++) {
                    if (usedGroups.has(j)) {
                        continue;
                    }

                    if (areGroupsConnected(chain[chain.length - 1], filteredGroups[j])) {
                        chain.push(filteredGroups[j]);
                        usedGroups.add(j);
                    }
                }

                chains.push(chain);
            }

            // Split chains into multi-group and single-group chains
            const multiGroupChains = chains.filter(chain => chain.length > 1);
            const singleGroupChains = chains.filter(chain => chain.length === 1);
            console.log("elength", multiGroupChains.length, singleGroupChains.length);

            // Convert multi-group chains to groups, maintaining the chain structure
            const multiGroups = multiGroupChains.map((chain, chainIndex) => {
                return chain.map((group, groupIndex) => ({
                    id: chainIndex * 100 + groupIndex + 1, // Unique ID for each group
                    photos: group.photos,
                    hasFace: group.hasFace,
                    chainId: chainIndex + 1,
                    isFirstInChain: groupIndex === 0,
                    nextGroup: groupIndex < chain.length - 1 ? {
                        id: chainIndex * 100 + groupIndex + 2,
                        photos: chain[groupIndex + 1].photos,
                        hasFace: chain[groupIndex + 1].hasFace
                    } : null,
                    similarity: groupIndex < chain.length - 1 ? Math.max(...group.photos.filter(p => p.metadata.hasFace).flatMap(facePhoto =>
                        chain[groupIndex + 1].photos.filter(p => p.metadata.hasFace).map(otherFacePhoto =>
                            cosineSimilarity(facePhoto.metadata.faceEmbedding, otherFacePhoto.metadata.faceEmbedding)
                        )
                    )) : null
                }));
            }).flat();

            // Convert single-group chains to unmatched groups
            const unmatchedGroupsList = singleGroupChains.map((chain, index) => {
                const group = chain[0];
                return {
                    id: multiGroups.length + index + 1,
                    photos: group.photos,
                    hasFace: group.hasFace,
                    isUnmatched: true
                };
            });

            // Keep multi-group chains and unmatched groups separate
            groups.value = multiGroups;
            unmatchedGroups.value = unmatchedGroupsList;

            isProcessing.value = false;
            currentStep.value = 3;
        };

        const showGroupFiles = (group) => {
            selectedGroup.value = group;
            showGroupFilesModal.value = true;
        };

        return {
            currentStep,
            steps,
            processedPhotos,
            sortedPhotos,
            failedPhotos,
            groups,
            unmatchedGroups,
            isProcessing,
            processingProgress,
            processedCount,
            totalPhotos,
            files,
            photosWithFaces,
            photosWithoutFaces,
            matchedGroups,
            selectedFilter,
            estimatedTimeRemaining,
            formatTime,
            handleFileSelect,
            handleDrop,
            startAnalysis,
            exportGroupInfo,
            exportSelectedPhotos,
            toggleFaceDetection,
            groupByTime,
            selectedPhoto,
            showGroupFiles,
            showGroupFilesModal,
            selectedGroup
        };
    }
});

// Create Vuetify instance
const vuetify = Vuetify.createVuetify({
    theme: {
        defaultTheme: 'light',
        themes: {
            light: {
                colors: {
                    primary: '#4a90e2',
                    secondary: '#f5f5f5',
                    success: '#4caf50',
                    error: '#f44336',
                    warning: '#ff9800',
                    info: '#2196f3'
                }
            }
        }
    }
});

app.use(vuetify).mount('#app');
