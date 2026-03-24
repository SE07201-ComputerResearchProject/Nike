import bcrypt from "bcrypt";

async function generateHash(): Promise<void> {
    const password = "Admin@OFuture2024!";
    const saltRounds = 12;

    const hash = await bcrypt.hash(password, saltRounds);

    console.log("Password:", password);
    console.log("Hash:", hash);
}

generateHash();