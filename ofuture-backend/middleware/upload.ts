import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Tạo thư mục public/uploads nếu nó chưa tồn tại
const uploadDir = path.join(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Cấu hình nơi lưu và tên file
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // PHÂN LOẠI: Nếu fieldname là 'avatar' thì đặt tên avatar-, ngược lại là product-
        const prefix = file.fieldname === 'avatar' ? 'avatar-' : 'product-';
        cb(null, prefix + uniqueSuffix + path.extname(file.originalname));
    }
});

// Bộ lọc: Chỉ cho phép upload ảnh
const fileFilter = (req: any, file: any, cb: any) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Chỉ cho phép tải lên định dạng hình ảnh!'), false);
    }
};

// Cấu hình giới hạn: Tối đa 5MB mỗi ảnh
export const uploadImages = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: fileFilter
});