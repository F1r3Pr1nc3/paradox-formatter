export interface ParadoxData {
    id: string;
    title: string;
    description: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface FormatterOptions {
    indentSize: number;
    includeMetadata: boolean;
}

export type FormatResult = {
    formattedData: string;
    errors?: string[];
};