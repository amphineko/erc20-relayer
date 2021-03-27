import { either } from 'fp-ts/lib/Either'
import { array, failure, literal, string, success, Type, type, TypeOf } from 'io-ts'

const positiveIntegerLiteral = new Type<string>(
    'NumberLiteral',
    string.is,
    (u, c) => either.chain(
        string.validate(u, c),
        (s) => /^\d+$/.test(s) ? success(s) : failure(s, c, `"${s}" is not a positive integer`)
    ),
    (a) => a
)

const positiveInteger = new Type<string, number>(
    'PositiveNumber',
    positiveIntegerLiteral.is,
    positiveIntegerLiteral.validate,
    (a) => parseInt(a)
)

export const tokenTransaction = type({
    blockNumber: positiveInteger,
    contractAddress: string,
    from: string,
    hash: string,
    to: string,
    value: positiveInteger
}, 'TokenTransaction')

export type TokenTransaction = TypeOf<typeof tokenTransaction>

export const tokenTransactionQueryResponse = type({
    message: literal('OK'),
    result: array(tokenTransaction),
    status: literal('1')
}, 'TokenTransactionQueryResponse')

export type TokenTransactionQueryResponse = TypeOf<typeof tokenTransactionQueryResponse>
